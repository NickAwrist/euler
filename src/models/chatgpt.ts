import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import {
  chatGptHostId,
  clearChatGptCredential,
  readChatGptCredential,
  readChatGptRegistration,
  saveChatGptCredential,
} from "../db/chatgpt";
import type { ChatGptCredential, ChatGptRegistration } from "../db/chatgpt";
import { OperationError } from "../observability/errors";
import { chatGptProfileSchema } from "../schemas/chatgpt";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const redirectUri = "http://127.0.0.1:1455/auth/callback";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
});
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  previous: (ChatGptRegistration & { idToken?: string }) | null;
  completing?: boolean;
};
const pending = new Map<string, Pending>();
const refreshes = new Map<string, Promise<ChatGptCredential>>();
const random = () => randomBytes(32).toString("base64url");
export function chatGptStatus(owner: string) {
  const credential = readChatGptCredential(owner);
  return {
    connected: Boolean(credential),
    email: credential?.email ?? null,
    name: credential?.name ?? null,
    picture: credential?.picture ?? null,
    planEnabled:
      credential?.scopes.includes("chatgpt.tokens.use.direct") ?? false,
  };
}
export function startChatGptLogin(owner: string, newAccount = false) {
  for (const [key, attempt] of pending)
    if (attempt.expiresAt < Date.now()) pending.delete(key);
  const attempt: Pending = {
    state: random(),
    nonce: random(),
    verifier: random(),
    expiresAt: Date.now() + 600_000,
    previous: newAccount
      ? null
      : (readChatGptCredential(owner) ?? readChatGptRegistration(owner)),
  };
  pending.set(owner, attempt);
  const url = new URL(`${issuer}/api/accounts/authorize`);
  const parameters: Record<string, string> = {
    client_id: attempt.previous?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: chatGptHostId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256")
      .update(attempt.verifier)
      .digest("base64url"),
  };
  if (attempt.previous?.idToken)
    parameters.id_token_hint = attempt.previous.idToken;
  if (!attempt.previous) parameters.agent_name_hint = "Euler";
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return { authorizationUrl: url.toString() };
}
async function exchange(parameters: Record<string, string>) {
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...parameters, resource }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new OperationError("INVALID_REQUEST", {
      message: "ChatGPT authorization failed. Sign in again.",
    });
  return tokenSchema.parse(await response.json());
}
export async function finishChatGptLogin(owner: string, callbackUrl: string) {
  const attempt = pending.get(owner);
  const url = new URL(callbackUrl);
  if (
    !attempt ||
    attempt.completing ||
    attempt.expiresAt < Date.now() ||
    url.origin !== new URL(redirectUri).origin ||
    url.pathname !== "/auth/callback" ||
    url.searchParams.get("state") !== attempt.state
  )
    throw new OperationError("INVALID_REQUEST", {
      message: "Invalid or expired ChatGPT sign-in. Start again.",
    });
  attempt.completing = true;
  if (url.searchParams.has("error"))
    throw new OperationError("INVALID_REQUEST", {
      message: "ChatGPT sign-in was declined.",
    });
  const code = url.searchParams.get("code");
  const clientId =
    url.searchParams.get("client_id") ?? attempt.previous?.clientId;
  if (
    !code ||
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (attempt.previous && clientId !== attempt.previous.clientId)
  )
    throw new OperationError("INVALID_REQUEST", {
      message: "Invalid ChatGPT registration.",
    });
  const tokens = await exchange({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: attempt.verifier,
    redirect_uri: redirectUri,
  });
  if (!tokens.id_token)
    throw new OperationError("INVALID_REQUEST", {
      message: "ChatGPT did not return an identity token.",
    });
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "sub", "nonce"],
  });
  if (
    payload.nonce !== attempt.nonce ||
    !payload.sub ||
    (attempt.previous && payload.sub !== attempt.previous.subject)
  )
    throw new OperationError("INVALID_REQUEST", {
      message: "ChatGPT account validation failed.",
    });
  if (pending.get(owner) !== attempt)
    throw new OperationError("INVALID_REQUEST", {
      message: "ChatGPT connection changed. Start again.",
    });
  pending.delete(owner);
  const name = chatGptProfileSchema.shape.name.safeParse(payload.name);
  const picture = chatGptProfileSchema.shape.picture.safeParse(payload.picture);
  saveChatGptCredential(owner, {
    clientId,
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: name.success ? name.data : null,
    picture: picture.success ? picture.data : null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return chatGptStatus(owner);
}
export async function chatGptAccessToken(owner: string): Promise<string> {
  let credential = readChatGptCredential(owner);
  if (!credential?.scopes.includes("chatgpt.tokens.use.direct"))
    throw new Error("Connect ChatGPT and enable plan usage in Settings.");
  if (credential.expiresAt < Date.now() + 60_000) {
    let refresh = refreshes.get(owner);
    if (!refresh) {
      const previous = credential;
      refresh = (async () => {
        if (!previous.refreshToken)
          throw new Error("ChatGPT session expired. Sign in again.");
        const tokens = await exchange({
          grant_type: "refresh_token",
          client_id: previous.clientId,
          refresh_token: previous.refreshToken,
        });
        const updated = {
          ...previous,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? previous.refreshToken,
          scopes:
            tokens.scope === undefined
              ? previous.scopes
              : tokens.scope.split(/\s+/).filter(Boolean),
          expiresAt: Date.now() + tokens.expires_in * 1000,
        };
        // A disconnect or new sign-in while refreshing must not resurrect old credentials.
        if (readChatGptCredential(owner)?.accessToken !== previous.accessToken)
          throw new Error("ChatGPT connection changed. Retry the request.");
        saveChatGptCredential(owner, updated);
        return updated;
      })();
      refreshes.set(owner, refresh);
    }
    try {
      credential = await refresh;
    } finally {
      if (refreshes.get(owner) === refresh) refreshes.delete(owner);
    }
  }
  if (!credential.scopes.includes("chatgpt.tokens.use.direct"))
    throw new Error("ChatGPT plan usage is disabled.");
  return credential.accessToken;
}
export async function disconnectChatGpt(owner: string) {
  pending.delete(owner);
  const credential = readChatGptCredential(owner);
  clearChatGptCredential(owner);
  let revoked = !credential?.refreshToken;
  if (credential?.refreshToken) {
    try {
      const response = await fetch(`${issuer}/api/accounts/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: credential.refreshToken,
          token_type_hint: "refresh_token",
          client_id: credential.clientId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }
  return { revoked };
}
const catalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      display_name: z.string(),
      visibility: z.string(),
    }),
  ),
});
export async function chatGptModels(owner: string) {
  const accessToken = await chatGptAccessToken(owner);
  const response = await fetch(`${resource}/models`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      "ChatGPT models unavailable. Check your connection in Settings.",
    );
  return catalogSchema
    .parse(await response.json())
    .models.filter((model) => model.visibility === "list");
}
