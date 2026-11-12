import { randomBytes } from "node:crypto";
import {
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
  auth,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  selectClientAuthMethod,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  InvalidClientError,
  InvalidGrantError,
  OAuthError,
  UnauthorizedClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import {
  type McpServerRow,
  getMcpServer,
  getMcpServerOAuth,
  updateMcpServerOAuth,
} from "../db/mcpServers";
import { envConfig } from "../env";
import { OperationError } from "../observability/errors";
import type { McpOAuthConfig } from "../schemas/mcp";
import { errorMessage } from "../utils/errors";

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";
/** Where the callback sends the iPhone app's sign-in sheet; the app listens for this scheme. */
export const MCP_OAUTH_APP_RETURN_URL = "euler://mcp-oauth";
const PENDING_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const OAUTH_TIMEOUT_MS = 20_000;

type PendingOAuthAttempt = {
  state: string;
  ownerUuid: string;
  serverId: string;
  serverUrl: string;
  redirectUri: string;
  codeVerifier: string;
  resourceMetadataUrl?: URL;
  scope?: string;
  returnToApp: boolean;
  expiresAt: number;
  completing?: boolean;
};

const pendingByState = new Map<string, PendingOAuthAttempt>();
const refreshes = new Map<string, Promise<void>>();
type CachedTokenResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  text: string;
};
const refreshByToken = new Map<string, Promise<CachedTokenResponse>>();
const REFRESH_DEDUP_TTL_MS = 5_000;

const randomToken = () => randomBytes(32).toString("base64url");

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function parseCallbackOrigin(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHost(url.hostname))
    ) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveMcpOAuthRedirectUri(
  config: McpOAuthConfig | null,
  redirectOrigin?: string,
): string {
  if (config?.redirectUri) return config.redirectUri;
  const origin =
    parseCallbackOrigin(redirectOrigin) ??
    parseCallbackOrigin(envConfig.publicUrl) ??
    `http://127.0.0.1:${envConfig.backendPort}`;
  return `${origin}${MCP_OAUTH_CALLBACK_PATH}`;
}

function pruneExpiredPending(): void {
  const now = Date.now();
  for (const [state, attempt] of pendingByState) {
    if (attempt.expiresAt < now) pendingByState.delete(state);
  }
}

function clearPendingForServer(ownerUuid: string, serverId: string): void {
  for (const [state, attempt] of pendingByState) {
    if (attempt.ownerUuid === ownerUuid && attempt.serverId === serverId) {
      pendingByState.delete(state);
    }
  }
}

function clearRefreshCacheForServer(ownerUuid: string, serverId: string): void {
  const prefix = `${ownerUuid}:${serverId}:`;
  for (const key of refreshByToken.keys()) {
    if (key.startsWith(prefix)) refreshByToken.delete(key);
  }
}

type ProviderMode = "interactive_start" | "code_exchange" | "runtime";

class StoredMcpOAuthProvider implements OAuthClientProvider {
  private verifier: string;
  private suppliedAccessToken: string | undefined;
  private suppliedRefreshToken: string | undefined;
  public redirectedTo: URL | null = null;

  constructor(
    private readonly ownerUuid: string,
    private readonly serverId: string,
    private readonly config: McpOAuthConfig | null,
    private readonly mode: ProviderMode,
    private readonly options: {
      redirectUri: string;
      state?: string;
      codeVerifier?: string;
    },
  ) {
    this.verifier = options.codeVerifier ?? "";
    if (this.mode === "interactive_start" && !this.config?.clientId) {
      this.saveClientInformation = (info: OAuthClientInformationMixed) => {
        updateMcpServerOAuth(this.ownerUuid, this.serverId, {
          clientInfo: info,
        });
      };
    }
  }

  saveClientInformation?: (
    clientInformation: OAuthClientInformationMixed,
  ) => void;

  get redirectUrl(): string | undefined {
    return this.config?.grantType === "client_credentials"
      ? undefined
      : this.options.redirectUri;
  }

  get clientMetadataUrl(): string | undefined {
    return this.config?.clientMetadataUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const scope = this.config?.scopes.length
      ? this.config.scopes.join(" ")
      : undefined;
    if (this.config?.grantType === "client_credentials") {
      return {
        redirect_uris: [],
        grant_types: ["client_credentials"],
        token_endpoint_auth_method: "client_secret_basic",
        client_name: "Euler",
        ...(scope ? { scope } : {}),
      };
    }
    return {
      redirect_uris: [this.options.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config?.clientSecret
        ? "client_secret_basic"
        : "none",
      client_name: "Euler",
      ...(scope ? { scope } : {}),
    };
  }

  state(): string {
    return this.options.state ?? randomToken();
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const record = getMcpServerOAuth(this.ownerUuid, this.serverId);
    if (this.config?.clientId) {
      return {
        client_id: this.config.clientId,
        ...(this.config.clientSecret
          ? { client_secret: this.config.clientSecret }
          : {}),
        ...(record?.clientInfo?.issuer
          ? { issuer: record.clientInfo.issuer }
          : {}),
      };
    }
    const saved = record?.clientInfo ?? undefined;
    if (
      saved &&
      this.mode === "interactive_start" &&
      "redirect_uris" in saved &&
      Array.isArray(saved.redirect_uris) &&
      !saved.redirect_uris.includes(this.options.redirectUri)
    ) {
      return undefined;
    }
    return saved;
  }

  tokens(): OAuthTokens | undefined {
    const current =
      getMcpServerOAuth(this.ownerUuid, this.serverId)?.tokens ?? undefined;
    if (!current) return undefined;
    if (
      this.mode === "runtime" &&
      this.suppliedAccessToken &&
      current.access_token !== this.suppliedAccessToken &&
      this.suppliedRefreshToken &&
      refreshByToken.has(
        `${this.ownerUuid}:${this.serverId}:${this.suppliedRefreshToken}`,
      )
    ) {
      const staleRefresh = this.suppliedRefreshToken;
      this.suppliedRefreshToken = undefined;
      return { ...current, refresh_token: staleRefresh };
    }
    this.suppliedAccessToken = current.access_token;
    this.suppliedRefreshToken = current.refresh_token;
    return current;
  }

  saveTokens(tokens: OAuthTokens): void {
    if (
      this.mode === "runtime" &&
      this.config?.grantType !== "client_credentials" &&
      !getMcpServerOAuth(this.ownerUuid, this.serverId)?.tokens
    ) {
      throw new UnauthorizedError("MCP OAuth connection changed");
    }
    this.suppliedAccessToken = tokens.access_token;
    this.suppliedRefreshToken = tokens.refresh_token;
    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null;
    updateMcpServerOAuth(this.ownerUuid, this.serverId, { tokens, expiresAt });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.redirectedTo = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error("Missing PKCE code verifier");
    return this.verifier;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return (
      getMcpServerOAuth(this.ownerUuid, this.serverId)?.discoveryState ??
      undefined
    );
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    updateMcpServerOAuth(this.ownerUuid, this.serverId, {
      discoveryState: {
        authorizationServerUrl: state.authorizationServerUrl,
        ...(state.resourceMetadataUrl
          ? { resourceMetadataUrl: state.resourceMetadataUrl }
          : {}),
        ...(state.resourceMetadata
          ? { resourceMetadata: state.resourceMetadata }
          : {}),
        ...(state.authorizationServerMetadata
          ? { authorizationServerMetadata: state.authorizationServerMetadata }
          : {}),
      },
    });
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    if (scope === "verifier") {
      this.verifier = "";
      return;
    }
    if (scope === "tokens") {
      updateMcpServerOAuth(this.ownerUuid, this.serverId, {
        tokens: null,
        expiresAt: null,
      });
    } else if (scope === "client") {
      updateMcpServerOAuth(this.ownerUuid, this.serverId, { clientInfo: null });
    } else if (scope === "discovery") {
      updateMcpServerOAuth(this.ownerUuid, this.serverId, {
        discoveryState: null,
      });
    } else {
      updateMcpServerOAuth(this.ownerUuid, this.serverId, {
        clientInfo: null,
        tokens: null,
        discoveryState: null,
        expiresAt: null,
      });
    }
  }

  prepareTokenRequest(scope?: string): URLSearchParams | undefined {
    if (this.config?.grantType !== "client_credentials") return undefined;
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    const resolvedScope = scope || this.config.scopes.join(" ");
    if (resolvedScope) params.set("scope", resolvedScope);
    return params;
  }
}

function timedFetch(signal?: AbortSignal): FetchLike {
  return (url, init) => {
    const timeout = AbortSignal.timeout(OAUTH_TIMEOUT_MS);
    const merged = signal
      ? AbortSignal.any([signal, timeout])
      : init?.signal
        ? AbortSignal.any([init.signal, timeout])
        : timeout;
    return fetch(url, { ...init, signal: merged });
  };
}

function extractRefreshTokenFromBody(
  body: BodyInit | null | undefined,
): string | null {
  if (!body) return null;
  const params =
    body instanceof URLSearchParams
      ? body
      : typeof body === "string"
        ? new URLSearchParams(body)
        : null;
  if (!params || params.get("grant_type") !== "refresh_token") return null;
  return params.get("refresh_token") || null;
}

function createCoalescedOAuthFetch(
  ownerUuid: string,
  serverId: string,
  signal?: AbortSignal,
): FetchLike {
  const baseFetch = timedFetch(signal);
  return async (url, init) => {
    const refreshToken =
      init?.method?.toUpperCase() === "POST"
        ? extractRefreshTokenFromBody(init.body)
        : null;
    if (!refreshToken) return baseFetch(url, init);

    const key = `${ownerUuid}:${serverId}:${refreshToken}`;
    let pending = refreshByToken.get(key);
    if (!pending) {
      const unsharedFetch = timedFetch();
      const { signal: _callerSignal, ...restInit } = init ?? {};
      pending = (async () => {
        const res = await unsharedFetch(url, restInit);
        const text = await res.text();
        const cached: CachedTokenResponse = {
          status: res.status,
          statusText: res.statusText,
          headers: [...res.headers.entries()],
          text,
        };
        if (res.ok) {
          setTimeout(() => {
            if (refreshByToken.get(key) === pending) refreshByToken.delete(key);
          }, REFRESH_DEDUP_TTL_MS).unref();
        } else if (refreshByToken.get(key) === pending) {
          refreshByToken.delete(key);
        }
        return cached;
      })();
      pending.catch(() => {
        if (refreshByToken.get(key) === pending) refreshByToken.delete(key);
      });
      refreshByToken.set(key, pending);
    }

    const cached = await pending;
    return new Response(cached.text, {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    });
  };
}

async function probeWwwAuthenticate(
  server: McpServerRow,
  accessToken?: string,
  signal?: AbortSignal,
): Promise<{ resourceMetadataUrl?: URL; scope?: string }> {
  const fetchFn = timedFetch(signal);
  const baseHeaders: Record<string, string> = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...server.headers,
  };
  try {
    const post = await fetchFn(server.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "euler", version: "1.0.0" },
        },
      }),
    });
    await post.body?.cancel();
    if (post.status === 401 || post.status === 403) {
      return extractWWWAuthenticateParams(post);
    }
    if (post.status === 404 || post.status === 405) {
      const sse = await fetchFn(server.url, {
        method: "GET",
        redirect: "manual",
        headers: { ...baseHeaders, Accept: "text/event-stream" },
      });
      await sse.body?.cancel();
      if (sse.status === 401 || sse.status === 403) {
        return extractWWWAuthenticateParams(sse);
      }
    }
  } catch {
    // Discovery will surface network errors with full context.
  }
  return {};
}

export function hasStaticAuthorizationHeader(
  headers: Record<string, string>,
): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization",
  );
}

export function isMcpAuthorizationRequired(
  server: Pick<McpServerRow, "headers" | "oauthConfig" | "oauthConnected">,
  error: unknown,
): boolean {
  if (
    hasStaticAuthorizationHeader(server.headers) &&
    !server.oauthConfig &&
    !server.oauthConnected
  ) {
    return false;
  }
  if (
    error instanceof UnauthorizedError ||
    error instanceof InvalidClientError ||
    error instanceof InvalidGrantError ||
    error instanceof UnauthorizedClientError
  ) {
    return true;
  }
  if (error instanceof StreamableHTTPError) {
    return (
      error.code === 401 ||
      (error.code === 403 && /insufficient_scope/i.test(error.message))
    );
  }
  if (error instanceof SseError) {
    return error.code === 401;
  }
  return false;
}

export async function startMcpServerOAuth(
  ownerUuid: string,
  serverId: string,
  options: { redirectOrigin?: string; returnToApp: boolean },
  signal?: AbortSignal,
): Promise<{
  authorizationUrl: string;
  redirectUri: string;
  server: McpServerRow;
}> {
  pruneExpiredPending();
  const row = getMcpServer(ownerUuid, serverId);
  if (!row) {
    throw new OperationError("NOT_FOUND", { message: "MCP server not found" });
  }
  clearPendingForServer(ownerUuid, serverId);

  const existing = getMcpServerOAuth(ownerUuid, serverId);
  const config = existing?.config ?? row.oauthConfig;
  const redirectUri = resolveMcpOAuthRedirectUri(
    config,
    options.redirectOrigin,
  );
  const state = randomToken();

  // Starting an interactive sign-in clears dead tokens so auth() begins fresh consent.
  if (config?.grantType !== "client_credentials" && existing?.tokens) {
    updateMcpServerOAuth(ownerUuid, serverId, {
      tokens: null,
      expiresAt: null,
    });
  }

  const challenge = await probeWwwAuthenticate(
    row,
    config?.grantType === "client_credentials"
      ? undefined
      : existing?.tokens?.access_token,
    signal,
  );

  const provider = new StoredMcpOAuthProvider(
    ownerUuid,
    serverId,
    config,
    "interactive_start",
    { redirectUri, state },
  );

  let result: "AUTHORIZED" | "REDIRECT";
  try {
    result = await auth(provider, {
      serverUrl: row.url,
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: challenge.scope,
      fetchFn: timedFetch(signal),
    });
  } catch (error) {
    throw new OperationError("INVALID_REQUEST", {
      message: `OAuth setup failed: ${errorMessage(error)}`,
    });
  }

  if (result === "AUTHORIZED") {
    const updated = getMcpServer(ownerUuid, serverId) ?? row;
    return { authorizationUrl: "", redirectUri, server: updated };
  }

  const authorizationUrl = provider.redirectedTo?.toString();
  if (!authorizationUrl) {
    throw new OperationError("INVALID_REQUEST", {
      message: "Authorization server did not provide a sign-in URL",
    });
  }

  pendingByState.set(state, {
    state,
    ownerUuid,
    serverId,
    serverUrl: row.url,
    redirectUri,
    codeVerifier: provider.codeVerifier(),
    resourceMetadataUrl: challenge.resourceMetadataUrl,
    scope: challenge.scope,
    returnToApp: options.returnToApp,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });

  const updated = getMcpServer(ownerUuid, serverId) ?? row;
  return { authorizationUrl, redirectUri, server: updated };
}

async function exchangePendingAttempt(
  attempt: PendingOAuthAttempt,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<McpServerRow> {
  if (attempt.completing || attempt.expiresAt < Date.now()) {
    pendingByState.delete(attempt.state);
    throw new OperationError("INVALID_REQUEST", {
      message: "Invalid or expired MCP sign-in. Start again.",
    });
  }
  attempt.completing = true;

  try {
    if (params.has("error")) {
      const description =
        params.get("error_description")?.trim() ||
        params.get("error")?.trim() ||
        "Authorization was declined";
      pendingByState.delete(attempt.state);
      throw new OperationError("INVALID_REQUEST", {
        message: `OAuth authorization failed: ${description}`,
      });
    }

    const code = params.get("code")?.trim();
    if (!code) {
      attempt.completing = false;
      throw new OperationError("INVALID_REQUEST", {
        message: "Callback URL is missing an authorization code.",
      });
    }

    const row = getMcpServer(attempt.ownerUuid, attempt.serverId);
    if (!row || row.url !== attempt.serverUrl) {
      pendingByState.delete(attempt.state);
      throw new OperationError("NOT_FOUND", {
        message: "MCP server changed or was removed. Start again.",
      });
    }

    const provider = new StoredMcpOAuthProvider(
      attempt.ownerUuid,
      attempt.serverId,
      row.oauthConfig,
      "code_exchange",
      {
        redirectUri: attempt.redirectUri,
        state: attempt.state,
        codeVerifier: attempt.codeVerifier,
      },
    );

    const result = await auth(provider, {
      serverUrl: row.url,
      authorizationCode: code,
      resourceMetadataUrl: attempt.resourceMetadataUrl,
      scope: attempt.scope,
      fetchFn: timedFetch(signal),
    });

    if (result !== "AUTHORIZED") {
      throw new OperationError("INVALID_REQUEST", {
        message: "MCP authorization did not complete. Start again.",
      });
    }

    pendingByState.delete(attempt.state);
    return getMcpServer(attempt.ownerUuid, attempt.serverId) ?? row;
  } catch (error) {
    if (error instanceof OperationError) throw error;
    pendingByState.delete(attempt.state);
    const detail =
      error instanceof OAuthError && error.message
        ? error.message
        : errorMessage(error);
    throw new OperationError("INVALID_REQUEST", {
      message: `OAuth token exchange failed: ${detail}`,
    });
  }
}

export async function finishMcpServerOAuth(
  ownerUuid: string,
  serverId: string,
  callbackUrl: string,
  signal?: AbortSignal,
): Promise<McpServerRow> {
  pruneExpiredPending();
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new OperationError("INVALID_REQUEST", {
      message: "Invalid callback URL.",
    });
  }
  const state = url.searchParams.get("state");
  const attempt = state ? pendingByState.get(state) : undefined;
  if (
    !attempt ||
    attempt.ownerUuid !== ownerUuid ||
    attempt.serverId !== serverId
  ) {
    throw new OperationError("INVALID_REQUEST", {
      message: "Invalid or expired MCP sign-in. Start again.",
    });
  }
  const expected = new URL(attempt.redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new OperationError("INVALID_REQUEST", {
      message: "Callback URL does not match the expected redirect URI.",
    });
  }
  return exchangePendingAttempt(attempt, url.searchParams, signal);
}

export async function completeMcpOAuthHttpCallback(
  params: URLSearchParams,
): Promise<
  | { ok: true; serverId: string; serverName: string; returnToApp: boolean }
  | { ok: false; serverId?: string; message: string; returnToApp: boolean }
> {
  pruneExpiredPending();
  const state = params.get("state");
  const attempt = state ? pendingByState.get(state) : undefined;
  if (!attempt) {
    return {
      ok: false,
      message: "Invalid or expired MCP sign-in. Return to Euler and try again.",
      returnToApp: false,
    };
  }
  const { returnToApp } = attempt;
  try {
    const server = await exchangePendingAttempt(attempt, params);
    return {
      ok: true,
      serverId: server.id,
      serverName: server.name,
      returnToApp,
    };
  } catch (error) {
    return {
      ok: false,
      serverId: attempt.serverId,
      message: errorMessage(error),
      returnToApp,
    };
  }
}

export async function disconnectMcpServerOAuth(
  ownerUuid: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ server: McpServerRow; revoked: boolean }> {
  const row = getMcpServer(ownerUuid, serverId);
  if (!row) {
    throw new OperationError("NOT_FOUND", { message: "MCP server not found" });
  }
  clearPendingForServer(ownerUuid, serverId);
  clearRefreshCacheForServer(ownerUuid, serverId);

  const stored = getMcpServerOAuth(ownerUuid, serverId);
  updateMcpServerOAuth(ownerUuid, serverId, {
    tokens: null,
    expiresAt: null,
  });

  const tokenToRevoke =
    stored?.tokens?.refresh_token ?? stored?.tokens?.access_token;
  const tokenHint = stored?.tokens?.refresh_token
    ? "refresh_token"
    : "access_token";
  let revoked = !tokenToRevoke;

  if (tokenToRevoke) {
    try {
      const fetchFn = timedFetch(signal);
      let metadata = stored?.discoveryState?.authorizationServerMetadata;
      if (!metadata) {
        const discovered = await discoverOAuthServerInfo(row.url, { fetchFn });
        metadata = discovered.authorizationServerMetadata;
      }
      const revocationEndpoint =
        metadata &&
        "revocation_endpoint" in metadata &&
        typeof metadata.revocation_endpoint === "string"
          ? metadata.revocation_endpoint
          : undefined;
      if (revocationEndpoint && metadata) {
        const clientInfo = row.oauthConfig?.clientId
          ? {
              client_id: row.oauthConfig.clientId,
              ...(row.oauthConfig.clientSecret
                ? { client_secret: row.oauthConfig.clientSecret }
                : {}),
            }
          : stored?.clientInfo;
        const body = new URLSearchParams({
          token: tokenToRevoke,
          token_type_hint: tokenHint,
        });
        const headers = new Headers({
          "Content-Type": "application/x-www-form-urlencoded",
        });
        if (clientInfo) {
          const revocationAuthMethods =
            "revocation_endpoint_auth_methods_supported" in metadata &&
            Array.isArray(metadata.revocation_endpoint_auth_methods_supported)
              ? metadata.revocation_endpoint_auth_methods_supported
              : undefined;
          const method = selectClientAuthMethod(
            clientInfo,
            revocationAuthMethods ??
              metadata.token_endpoint_auth_methods_supported ??
              [],
          );
          if (method === "client_secret_basic" && clientInfo.client_secret) {
            const encoded = Buffer.from(
              `${clientInfo.client_id}:${clientInfo.client_secret}`,
            ).toString("base64");
            headers.set("Authorization", `Basic ${encoded}`);
          } else {
            body.set("client_id", clientInfo.client_id);
            if (method === "client_secret_post" && clientInfo.client_secret) {
              body.set("client_secret", clientInfo.client_secret);
            }
          }
        }
        const response = await fetchFn(revocationEndpoint, {
          method: "POST",
          headers,
          body,
        });
        await response.body?.cancel();
        revoked = response.ok;
      } else {
        revoked = false;
      }
    } catch {
      revoked = false;
    }
  }

  return {
    server: getMcpServer(ownerUuid, serverId) ?? row,
    revoked,
  };
}

/**
 * Prepares runtime OAuth provider and coalesced fetch, proactively refreshing
 * near-expiry or client_credentials tokens using a per-server single-flight lock.
 */
export async function prepareMcpTransportAuth(
  server: Pick<McpServerRow, "url" | "headers"> &
    Partial<Pick<McpServerRow, "id" | "owner_uuid" | "oauthConfig">>,
  signal?: AbortSignal,
): Promise<
  { authProvider: OAuthClientProvider; fetch: FetchLike } | undefined
> {
  if (!server.id || !server.owner_uuid) return undefined;
  const ownerUuid = server.owner_uuid;
  const serverId = server.id;
  const stored = getMcpServerOAuth(ownerUuid, serverId);
  const config = stored?.config ?? server.oauthConfig ?? null;
  const isClientCredentials = config?.grantType === "client_credentials";

  if (!stored?.tokens && !isClientCredentials) {
    return undefined;
  }

  const redirectUri = resolveMcpOAuthRedirectUri(config);
  const fetchFn = createCoalescedOAuthFetch(ownerUuid, serverId, signal);
  const provider = new StoredMcpOAuthProvider(
    ownerUuid,
    serverId,
    config,
    "runtime",
    { redirectUri },
  );

  const needsProactiveAuth = isClientCredentials
    ? !stored?.tokens ||
      (stored.expiresAt !== null &&
        stored.expiresAt <= Date.now() + REFRESH_SKEW_MS)
    : Boolean(
        stored?.tokens?.refresh_token &&
          stored.expiresAt !== null &&
          stored.expiresAt <= Date.now() + REFRESH_SKEW_MS,
      );

  if (needsProactiveAuth) {
    const key = `${ownerUuid}:${serverId}`;
    let inFlight = refreshes.get(key);
    if (!inFlight) {
      inFlight = (async () => {
        const result = await auth(provider, {
          serverUrl: server.url,
          fetchFn,
        });
        if (result !== "AUTHORIZED") {
          throw new UnauthorizedError("Authorization required");
        }
      })();
      refreshes.set(key, inFlight);
    }
    try {
      await inFlight;
    } finally {
      if (refreshes.get(key) === inFlight) refreshes.delete(key);
    }
  }

  return { authProvider: provider, fetch: fetchFn };
}
