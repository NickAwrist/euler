const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Whether the caller is on the server's own machine. A proxy on this machine,
 * such as the Vite dev server, connects from loopback and names its client in
 * X-Forwarded-For; the hop it appended last must be loopback too, so a tailnet
 * client never passes through the proxy.
 */
export function isLoopbackRequest(
  remoteAddress: string,
  forwardedFor: string | undefined,
): boolean {
  if (!LOOPBACK.has(remoteAddress)) return false;
  if (forwardedFor === undefined) return true;
  const hops = forwardedFor.split(",").map((hop) => hop.trim());
  return LOOPBACK.has(hops.at(-1) ?? "");
}
