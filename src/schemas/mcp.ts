import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  OpenIdProviderDiscoveryMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";

/** Server names prefix tool names, so they use only characters providers accept. */
const McpServerNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

const HttpUrlSchema = z.url({
  protocol: /^https?$/,
  error: "url must be an http(s) URL",
});

const ClientMetadataUrlSchema = z
  .url({
    protocol: /^https$/,
    error: "oauth.clientMetadataUrl must be an https URL",
  })
  .refine(
    (value) => new URL(value).pathname !== "/",
    "oauth.clientMetadataUrl must include a non-root path",
  );

export const McpOAuthGrantTypeSchema = z.enum([
  "authorization_code",
  "client_credentials",
]);

export const McpOAuthConfigSchema = z.object({
  grantType: McpOAuthGrantTypeSchema,
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)),
  clientMetadataUrl: ClientMetadataUrlSchema.optional(),
  redirectUri: HttpUrlSchema.optional(),
});

export type McpOAuthConfig = z.output<typeof McpOAuthConfigSchema>;

const McpOAuthInputObjectSchema = z
  .object({
    grantType: McpOAuthGrantTypeSchema.optional(),
    grant_type: McpOAuthGrantTypeSchema.optional(),
    clientId: z.string().trim().min(1).optional(),
    client_id: z.string().trim().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    client_secret: z.string().min(1).optional(),
    scopes: z.array(z.string().trim().min(1)).optional(),
    scope: z.string().optional(),
    clientMetadataUrl: ClientMetadataUrlSchema.optional(),
    client_metadata_url: ClientMetadataUrlSchema.optional(),
    redirectUri: HttpUrlSchema.optional(),
    redirect_uri: HttpUrlSchema.optional(),
  })
  .transform((raw): McpOAuthConfig => {
    const grantType = raw.grantType ?? raw.grant_type ?? "authorization_code";
    const clientId = raw.clientId ?? raw.client_id;
    const clientSecret = raw.clientSecret ?? raw.client_secret;
    const scopes =
      raw.scopes ?? (raw.scope ? raw.scope.split(/\s+/).filter(Boolean) : []);
    const clientMetadataUrl = raw.clientMetadataUrl ?? raw.client_metadata_url;
    const redirectUri = raw.redirectUri ?? raw.redirect_uri;
    return {
      grantType,
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
      scopes,
      ...(clientMetadataUrl ? { clientMetadataUrl } : {}),
      ...(redirectUri ? { redirectUri } : {}),
    };
  })
  .superRefine((oauth, ctx) => {
    if (oauth.clientSecret && !oauth.clientId) {
      ctx.addIssue({
        code: "custom",
        message: "oauth.clientSecret requires oauth.clientId",
      });
    }
    if (
      oauth.grantType === "client_credentials" &&
      (!oauth.clientId || !oauth.clientSecret)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "oauth client_credentials requires oauth.clientId and oauth.clientSecret",
      });
    }
  });

const McpOAuthInputSchema = z
  .union([z.boolean(), McpOAuthInputObjectSchema])
  .transform((value): McpOAuthConfig | null => {
    if (typeof value === "boolean") {
      return value ? { grantType: "authorization_code", scopes: [] } : null;
    }
    return value;
  });

const McpServerEntrySchema = z.object({
  // Checked first so a pasted local server gets this message, not a url error.
  command: z
    .undefined({
      error:
        "local (command) servers are not supported; use a remote server url",
    })
    .optional(),
  url: HttpUrlSchema,
  headers: z.record(z.string(), z.string()).default({}),
  oauth: McpOAuthInputSchema.optional(),
});

const McpServerMapSchema = z.record(McpServerNameSchema, McpServerEntrySchema, {
  error: (issue) =>
    issue.code === "invalid_key"
      ? "server names must be 1-32 letters, numbers, hyphens, or underscores"
      : undefined,
});

/**
 * The `mcpServers` config users paste from MCP server docs. Some clients use
 * `servers` for the same map.
 */
export const McpConfigSchema = z
  .object({
    mcpServers: McpServerMapSchema.optional(),
    servers: McpServerMapSchema.optional(),
  })
  .transform((config) =>
    Object.entries(config.mcpServers ?? config.servers ?? {}).map(
      ([name, { url, headers, oauth }]) => ({
        name,
        url,
        headers,
        ...(oauth ? { oauth } : {}),
      }),
    ),
  )
  .refine((servers) => servers.length > 0, "config has no mcpServers");

export type McpServerWrite = z.output<typeof McpConfigSchema>[number];

export const StoredMcpHeadersSchema = z.record(z.string(), z.string());

// Full registration metadata is checked first so redirect_uris are preserved.
export const StoredMcpClientInfoSchema = z.union([
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
]);

export const StoredMcpTokensSchema = OAuthTokensSchema;

export const StoredMcpDiscoveryStateSchema = z.object({
  authorizationServerUrl: z.string().min(1),
  resourceMetadataUrl: z.string().min(1).optional(),
  resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(),
  authorizationServerMetadata: z
    .union([OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema])
    .optional(),
});
