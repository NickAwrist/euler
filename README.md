<p align="center">
  <img src="public/icons/euler.svg" alt="Euler icon" width="96">
</p>

<h1 align="center">Euler</h1>

A local-first agent runtime with a chat UI in the browser and a native iPhone
app. Run local models through [Ollama](https://ollama.com/), remote models
through [OpenRouter](https://openrouter.ai/), or connect your ChatGPT plan.

Each chat runs one agent, which can hand work to subagents. Its shell and file
tools run in a sandbox or in a local directory you pick. You can add skills and
remote MCP servers, and set allow, ask, and deny rules for tool calls.

## Requirements

- [Bun](https://bun.sh/)
- A model provider: Ollama, an OpenRouter API key, or a ChatGPT plan
- Linux with procfs for the file tools
- [Bubblewrap](https://github.com/containers/bubblewrap) for the shell tools.
  Ubuntu 24.04 needs an
  [AppArmor profile](docs/workspaces.md#bubblewrap-on-ubuntu-2404) too.
- Optional: ComfyUI for image generation, a Brave Search API key for web search

## Quick start

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:5174`. For local inference, run Ollama and install a
model. For remote inference, set up **Settings > OpenRouter** or
**Settings > ChatGPT**.

## Documentation

### Using Euler

- [Customization](docs/customization.md): the system prompt, skills, built-in
  tools, and MCP servers
- [Tool permissions](docs/tool-permissions.md): rules and approvals
- [Workspaces](docs/workspaces.md): sandboxes, local directories, and artifacts

### Running Euler

- [Configuration](docs/configuration.md): `.env`, providers, and ChatGPT sign-in
- [Deployment](docs/deployment.md): deployctl and HTTPS
- [Development](docs/development.md): worktrees, checks, and project structure

### Reference

- [The Connect API](docs/connect-api.md): the RPC contract, event stream, and
  push
- [Euler for iPhone](ios/README.md): setup, how the app works, and tests
- [Performance check](scripts/performance/README.md): what CI measures and why

Bugs and feature requests are tracked in
[GitHub issues](https://github.com/NickAwrist/euler/issues). The
[codebase audit](docs/audit-issues.md) lists known code-level problems.
