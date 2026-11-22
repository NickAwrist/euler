<p align="center">
  <img src="public/icons/euler.svg" alt="Euler icon" width="96">
</p>

<h1 align="center">Euler</h1>

A local-first agent runtime with a chat UI in the browser and a native iPhone
app. Run local models through [Ollama](https://ollama.com/), remote models
through [OpenRouter](https://openrouter.ai/) or
[Vercel AI Gateway](https://vercel.com/ai-gateway), or connect your ChatGPT plan.

Each chat runs one agent, which can hand work to subagents. Its shell and file
tools run in a sandbox or in a local directory you pick. You can add skills and
remote MCP servers, and set allow, ask, and deny rules for tool calls.

## Requirements

- [Bun](https://bun.sh/)
- A model provider: Ollama, an OpenRouter or Vercel AI Gateway API key, or a ChatGPT plan

Everything else is a feature. An agent gets a feature's tools once the
feature's own requirement is met:

| Feature | Needs |
| --- | --- |
| Files | Linux with procfs |
| Sandbox | [Bubblewrap](https://github.com/containers/bubblewrap). Ubuntu 24.04 needs an [AppArmor profile](docs/workspaces.md#bubblewrap-on-ubuntu-2404) too. |
| Web search | A Brave Search API key |
| Image generation | An OpenRouter or Vercel AI Gateway API key |
| Subagents | Nothing |
| Skills | Nothing |
| MCP servers | An enabled server |

## Quick start

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:5174`. For local inference, run Ollama and install a
model. For remote inference, set up **Settings > OpenRouter**,
**Settings > Vercel AI Gateway**, or **Settings > ChatGPT**.

## Documentation

### Using Euler

- [Customization](docs/customization.md): the system prompt, skills, features,
  and MCP servers
- [Tool permissions](docs/tool-permissions.md): rules and approvals
- [Workspaces](docs/workspaces.md): sandboxes, local directories, and file
  previews

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
