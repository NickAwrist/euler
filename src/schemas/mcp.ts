import { z } from "zod";

/** Server names prefix tool names, so they use only characters providers accept. */
const McpServerNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

const McpServerEntrySchema = z.object({
  // Checked first so a pasted local server gets this message, not a url error.
  command: z
    .undefined({
      error:
        "local (command) servers are not supported; use a remote server url",
    })
    .optional(),
  url: z.url({ protocol: /^https?$/, error: "url must be an http(s) URL" }),
  headers: z.record(z.string(), z.string()).default({}),
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
      ([name, { url, headers }]) => ({ name, url, headers }),
    ),
  )
  .refine((servers) => servers.length > 0, "config has no mcpServers");

export type McpServerWrite = z.output<typeof McpConfigSchema>[number];
