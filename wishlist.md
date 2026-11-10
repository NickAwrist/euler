# Wishlist

Remaining work, checked against the source on November 1, 2026.

- Interactive artifact charts. HTML previews currently disable scripts.
- Shared private networking and explicit browser service exposure for sandbox workspaces.
  See [Shared session networking](docs/design/session-networking.md).
- Apply the concurrent-agent limit (`EULER_MAX_RUNNING_AGENTS`) only to local models.
  Local models share this machine's CPU, GPU, and memory. This needs an explicit
  local/remote model property rather than inferring it from the provider.
