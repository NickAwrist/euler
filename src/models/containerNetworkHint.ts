import { existsSync } from "node:fs";

export function isRunningInContainer(): boolean {
  return existsSync("/.dockerenv") || process.env.CONTAINER === "true";
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "localhost" || host === "127.0.0.1" || host === "::1")
    );
  } catch {
    return false;
  }
}

export function withContainerLoopbackHint(error: string, host: string): string {
  if (!host || !isRunningInContainer() || !isLoopbackHttpUrl(host)) {
    return error;
  }

  return `${error} This app is running in Docker, so localhost/127.0.0.1 points at the container, not the Linux host. Use a container-reachable host URL such as http://host.docker.internal:<port>, and make sure the upstream service listens on an address outside host loopback.`;
}
