Really want

- MCPs
- Artifacts: interactive charts.
- Background tools and shared networking per session/workspace:
  - Opt-in background execution with job inspection, cancellation, and terminal inbox notifications.
  - Shared session networking so later commands can reach development servers, plus explicit browser service exposure.
  - Design: [Background tools and shared session networking](docs/design/background-tools-and-session-networking.md).

Low priority / Nice to have

- Apply the concurrent-agent limit (`EULER_MAX_RUNNING_AGENTS`) only to local models:
  - Local models share this machine's CPU, GPU, and memory; remote providers do not and can run more in parallel.
  - Needs each model to declare where it runs, such as a `local` or `remote` kind, instead of inferring it from the provider, so other local runtimes besides Ollama are covered.

- Tool approval:
  - Must default to always allow (opt-in only to avoid workflow friction).
  - Abstract policy engine decoupled from specific tools, supporting user-defined regex allow lists and block lists (e.g. matching command lines, file patterns, or tool arguments).
