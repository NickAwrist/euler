import type { Icon } from "@modelcontextprotocol/sdk/types.js";
import { type DisplayIcon, DisplayIconSchema } from "../schemas/icons";

/** Do not send credentials or load third-party tracking images for MCP icons. */
export function safeMcpIcons(
  icons: readonly Icon[],
  serverUrl: string,
): DisplayIcon[] {
  const origin = new URL(serverUrl).origin;
  return icons.flatMap((icon) => {
    const parsed = DisplayIconSchema.safeParse(icon);
    if (!parsed.success) return [];
    if (parsed.data.src.startsWith("data:")) return [parsed.data];
    return new URL(parsed.data.src).origin === origin ? [parsed.data] : [];
  });
}
