# Euler

A local-first agent runtime with a chat UI in the browser and a native iPhone
app. Run local models through [Ollama](https://ollama.com/), remote models
through OpenRouter, or connect your ChatGPT plan.

Every chat uses one agent with the enabled tools. It can hand self-contained
work to subagents, which share its system prompt and built-in tools but run in a
fresh context. Subagents cannot start their own subagents or change skills. Customize the system prompt under **Customization > Personalization**.

Custom skills live under **Customization > Skills**. A skill follows the
`SKILL.md` shape: a lowercase hyphenated name, a description that tells agents
when to use it, and Markdown instructions. Agents receive only the skill
metadata until they load a matching skill. Type `$skill-name` in a message to
invoke one directly. **Import** reads a pasted `SKILL.md`, including the
`user-invocable` and `disable-model-invocation` frontmatter fields. Turn off
**Users can invoke** to hide a skill from `$skill-name`, or **Agents can load
automatically** to keep it out of the agent's skill list. You can also ask the
agent to create, edit, or delete a skill, for example "update my storytelling
skill to open with dialogue". Subagents can't change skills.

Agent tools live under **Customization > Tools**, per user. **Built-in
capabilities** turns web search, image generation, the shell, file tools, or
skill management off for that user's agents, for example to use an MCP server's image generation
instead.

Remote [MCP](https://modelcontextprotocol.io/) servers are listed on the same tab. **Add** reads a pasted `mcpServers`
config with a `url` and optional `headers` for each server, such as an
`Authorization` token. Header values are stored but never returned by the API.
Local servers configured with `command` are rejected because they would run
outside the shell sandbox. Each agent activation connects to the enabled servers
over Streamable HTTP and offers their tools as `mcp__<server>__<tool>`. A server
that fails to connect is skipped and logged. The tab connects to each server
to list its tools, or shows why it could not connect.

## Artifacts and appearance

The artifact sidebar previews workspace files, including Markdown, images, and
HTML with inline CSS. HTML previews disable scripts and external resources.
Choose themes, interface and code fonts, and chat layout under
**Settings > Appearance**.

## ChatGPT inference

Under **Settings > ChatGPT**, sign in and authorize use of your ChatGPT plan.
After sign-in redirects to the loopback callback page, copy its full address
into the Callback URL field and select **Connect**. This manual step also works
when the browser is on a different machine from the Euler server.

The connection belongs to your Euler user UUID. Other users connect their own
accounts. Credentials stay on the server in owner-only files under
`<data root>/chatgpt/`; they are never returned to the browser. ChatGPT models
appear in the model selector after connection. **Disconnect** clears local
credentials and attempts to revoke the renewable session.

This uses OpenAI's [Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [Responses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
Access and limits depend on the signed-in account's granted plan permissions.

## Requirements

- [Bun](https://bun.sh/)
- A model provider: Ollama, an OpenRouter API key, or a connected ChatGPT plan
- Linux with procfs for workspace file tools, and working Bubblewrap at
  `/usr/bin/bwrap` or `/bin/bwrap` for shell tools
- Optional services: ComfyUI for image generation and a Brave Search API key for web search

## Setup

```bash
bun install
cp .env.example .env
```

Edit `.env` before starting. For local inference, run Ollama and install a model.
For remote inference, configure **Settings > OpenRouter** or **Settings > ChatGPT**.
Ollama is not required for remote inference.

## Development

Runs the backend server and UI together.

```bash
bun run dev
```

Individual processes:

```bash
bun run dev:server
bun run dev:ui
```

Bun and Vite load `.env` automatically. Restart the dev processes after changing it.
The file is ignored by Git. For example:

```bash
EULER_BACKEND_PORT=3000
EULER_BACKEND_HOST=127.0.0.1
EULER_FRONTEND_PORT=5174
EULER_OLLAMA_HOST=http://127.0.0.1:11434
EULER_COMFYUI_HOST=http://127.0.0.1:8188
```

For provider endpoints and API keys, nonempty environment values take precedence
over saved settings and defaults.
Environment-controlled endpoint fields are disabled in the UI. Remove the environment
value and restart the server to manage that endpoint through the UI. API requests that
change an environment-controlled endpoint are rejected; saving other settings still works.
Empty or whitespace-only optional values are treated as unset.

In development, the backend API and Vite UI are separate processes:

- `EULER_BACKEND_PORT` controls the API server. Default: `3000`.
- `EULER_FRONTEND_PORT` controls the Vite dev server. Default: `5174`.

`EULER_MAX_RUNNING_AGENTS` sets how many agent activations, replies and subagents,
one user may run at once across all chats. Extra work waits as queued. Default: `4`.

See [.env.example](.env.example) for storage paths, background-job limits, provider
API keys, and other overrides. `EULER_SERVE_FRONTEND=false` disables serving the
built UI from the backend. Vite still serves the development UI.

## Worktree development

From a new worktree, run:

```bash
bun run init:worktree
# Edit .env, including unused EULER_BACKEND_PORT and EULER_FRONTEND_PORT values.
bun run dev
```

The initializer copies your primary checkout's `.env`, or `.env.example` if no
local file exists. It sets `EULER_DB_PATH` and `EULER_DATA_ROOT` to the worktree's
own `data/` directory and links the primary checkout's `node_modules` when available.
Existing `.env` files and dependencies are preserved. Run `bun install` if the
primary checkout has no dependencies installed.

New worktrees copy the primary checkout's SQLite database and retained workspaces.
The database snapshot includes committed WAL data. Existing destination data is
preserved, and rerunning setup with an existing `.env` does not copy data again.
Workspace trash and ChatGPT connections are not copied; reconnect under
**Settings > ChatGPT**. Environment values
in `.env` take precedence over copied Settings values, including in existing worktrees.
The primary database and existing worktrees are unchanged. Service endpoints,
environment API keys, and `EULER_HOST_DIRECTORY` are copied unchanged. Open `/` on your configured Vite
port to use the full app with these settings.

You can also run `bun run init:worktree /path/to/worktree` from the primary checkout.
T3 Code can invoke the same command on worktree creation using its
`T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` variables. Running it in the primary
checkout creates `.env` from the example if needed.

The `/dev/...` routes are isolated UI examples for automated browser checks.
Both `bun test` and `bun run test` automatically load the test setup, which uses an
in-memory database and mocked services. Dev instances use your real configuration.

## Deployment (deployctl)

Deploy natively with [deployctl](https://github.com/NickAwrist/deployctl) using systemd process supervision:

```bash
deployctl create git@github.com:NickAwrist/euler.git --name agents
deployctl deploy agents --build
```

In production, the backend server serves both the built UI and API from a single
process on `EULER_BACKEND_HOST:EULER_BACKEND_PORT` (default `127.0.0.1:3000`).
Set `EULER_BACKEND_HOST` to accept remote connections.

`deployctl.yaml` specifies build commands and runtime service configuration:
- `build.commands`: installs dependencies and runs `bun run build` to generate `dist/`.
- `build.include`: packages `package.json`, `bun.lock`, `tsconfig.json`, `src`, `dist`, and `node_modules` into the immutable release directory.
- `services.euler`: executes `bun run src/server.ts` supervised by systemd.

Persistent application data (SQLite database, workspaces, workspace trash, and
ChatGPT credentials) is stored in `DEPLOYCTL_DATA_DIR`, which deployctl provides
and preserves across releases, unless `EULER_DB_PATH` or `EULER_DATA_ROOT`
override it.

To update and redeploy:

```bash
deployctl update agents --build
deployctl deploy agents
deployctl status agents
```

`update --build` prepares a release; `deploy` applies it. Check the applied
release and source SHA with `status`. The commands use the existing deployment
name `agents`; use your chosen name for a separate installation.

Manage environment variables with `deployctl env`:

```bash
deployctl env set agents EULER_BACKEND_PORT=3100
deployctl restart agents
```

## Tool permissions

Customization's Tools tab has one rule list with Allow, Ask, and Deny actions.
The tool picker lists currently enabled built-in, agent, skill, and connected
MCP tools. Select All tools and Ask to require approval, then add individual
Allow exceptions. Argument fields come from the selected tool's own schema,
including nested paths. Enum and boolean values use pickers, numeric fields
use numbers, and text fields support exact values or regex. Regex uses RE2 syntax with no slash
delimiters; use `^npm\s+publish\b` to match a command at the start, or
`npm\s+publish` to match it anywhere. Invalid patterns are rejected. A rule can
also match any arguments or the complete arguments saved from an
approval. Deny rules always
win; otherwise chat/workspace scope takes precedence, then a specific tool
over All tools, then argument conditions, then the most recently saved rule.
Calls with no matching rule are allowed.

Approval requests appear above the chat input for both main agents and
subagents. Allow once resumes just that call. Allow matching calls immediately
saves an exact-arguments rule for the same chat and workspace and resumes the
call; Undo removes that rule. The input remains available, and no modal or
navigation is required. Rules also apply to user-configured MCP tool names.
Disabled built-in capabilities remain hard denials.

PermissionService decides whether to allow, deny, or ask; ToolApprovalCoordinator
handles pending requests. Background jobs are created only after authorization.
Pending approvals release execution slots, survive browser reloads through the
runtime snapshot, and are cancelled by Stop, rewind, or deletion. Backend restart
interrupts pending calls instead of retaining approvals or replaying execution.
Rules are stored in user preferences and remain across backend restarts.
Deleting a chat removes its scoped rules while preserving global rules and rules
for other chats.

Shell argument rules compare command text. Scripts, interpreters, quoting, or
other command forms can bypass that comparison, so these rules are guardrails;
filesystem and network policy still provide the underlying containment.

## Workspaces

Shell commands and file tools use `/workspace` for both private and selected
local workspaces. File tools also accept relative paths within that directory.
The UI shows the selected host directory for local workspaces.

Run permissions are resolved by `src/permissions/PermissionService.ts`. The
dispatcher checks them before tool execution, and background jobs and the shell
runner enforce the same policy. Existing capability switches continue to gate
built-in tools; user-configured MCP calls also pass through argument rules and
approvals, while their server connections retain their configured access.

`/sandbox` keeps isolated networking and existing resource limits. `/directory`
uses a development policy with host networking, read-only access to the `bun`
and `node` binaries, and no virtual-memory cap. Toolchains are discovered from
the backend's own runtime executable first, then its PATH. Script shims, such as
version-manager wrappers, are skipped. Bunx is available when Bun is found.
Other package managers, such as npm, are available only if installed under
`/usr` or `/usr/local`. Both policies keep the selected workspace mounted
at `/workspace`, system files read-only, and the host home and environment hidden.
Credentials inside the selected folder remain accessible to the agent.
Directory commands use a temporary home so package-manager caches do not clutter
the selected folder. That home and its caches are discarded after each command.
When a root backend switches to a local directory's owner, toolchain discovery
skips executables that owner cannot read and execute, including root-private
installations. Install runtimes in a location accessible to that owner.

Directory commands can download dependencies and reach services on the backend
machine and its local network. Background servers share host ports with other
chats and applications. Use background execution for long-running servers and
bind to `0.0.0.0` to access them remotely. Private sandbox commands still have
separate networks and cannot expose servers to the host browser.
Host networking also reaches loopback-only services such as Euler, Ollama, and
ComfyUI. Requests from directory commands count as local requests, so loopback
checks do not distinguish an agent command from a person using the machine.

Workspace file operations require Linux with procfs. Reads, writes, directory
listing, and scans open path components without following symlinks. Deletes use
an open parent directory and unlink the final entry without following it. Ignore
rules are read only from within the workspace through the same protected access.

Run `/link` in a chat to work in another chat's sandbox. Linking to a chat that
is itself linked joins the same sandbox, so links never chain. `/sandbox`
returns the chat to its own sandbox. A sandbox is kept while any chat created it
or links to it. Once the last of them is deleted or switches away, it moves to
the workspace trash for 7 days.

Ephemeral chats expire after 24 hours, or `EULER_EPHEMERAL_CHAT_TTL_HOURS`. The
server checks for expired chats every minute, deferring deletion while agents
or background jobs are running, and permanently deletes their messages, agents, jobs, and sandbox without
moving it to the trash. A sandbox another chat still links to is kept, and goes
to the trash once no chat uses it. Selected local directories are never removed.

Most sandbox integration tests report skips when Bubblewrap is unavailable;
`tests/sandbox/background.test.ts` fails instead. Run `bun test tests/sandbox`
on a Linux host with working Bubblewrap namespaces to verify workspace writes
and network isolation.

### Bubblewrap on Ubuntu 24.04

If shell tools report `loopback: Failed RTM_NEWADDR: Operation not permitted`,
check `journalctl -k` for AppArmor denials involving `bwrap` and the
`unprivileged_userns` profile. Ubuntu can block the capabilities Bubblewrap
needs to create its sandbox, including its isolated loopback interface.

For `/usr/bin/bwrap`, install the included application-specific profile:

```bash
sudo install -m 0644 config/apparmor/euler-bwrap /etc/apparmor.d/euler-bwrap
sudo apparmor_parser -r /etc/apparmor.d/euler-bwrap
```

This follows [Ubuntu's application-specific user namespace guidance](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).
The profile permits Bubblewrap to create user namespaces. The runner continues
using its filesystem restrictions and the active workspace's network policy.

Restart the backend after loading the profile because it caches the sandbox
capability check. Then run the sandbox tests above; workspace writes and network
isolation tests should run rather than skip.

## Message UI demo and browser checks

Run `bun run dev:ui` and open `/dev/messages` on the Vite server. The demo uses
real message components with in-memory examples for single-line, multiline, and
scrolling code. On touch devices, hold a user message for its actions;
otherwise use its dots button. Tap the dots beside an assistant reply. Copy,
edit, regenerate with reply versions, their confirmations, and trace viewing
work without a backend or model. Reload to reset the examples. The route and fixtures are
excluded from production builds.

To check the layout on a headless server:

```bash
bunx playwright install chromium --no-shell
bun run test:browser
```

The browser checks start a temporary Vite server on port 5199, exercise mobile
and desktop interactions, and save conversation and popover screenshots in
`.cache/browser-results/`. No display server is needed. Files use `.pw.ts` so
Bun's unit-test discovery does not run the Playwright suite.

## Checks

```bash
bun test
bunx tsc --noEmit
bun run lint
bun run build
bun run test:browser
```

CI currently builds the app and runs the production performance gate. See
[scripts/performance/README.md](scripts/performance/README.md) for local commands
and baseline updates. CI does not yet run all the checks above.

## Documentation

- [The Connect API](docs/connect-api.md) covers the contract in `proto/`, the event stream, and push.
- [Euler for iPhone](ios/README.md) covers the iOS app.
- [Issue triage](BUG_TRIAGE.md), the [codebase audit](docs/audit-issues.md), and the [wishlist](wishlist.md) track remaining work.
- [Shared session networking](docs/design/session-networking.md) is a proposal for sandbox workspaces.
- `.claude/skills/test-euler-web/` and `.claude/skills/test-euler-ios/` tell coding agents how to test each app.

## Project structure

- `proto/` - the API contract; `bun run proto` generates `src/gen/` and the Swift in `ios/EulerAPI/`
- `src/` - backend server, RPC handlers, agent loop, tools, and session storage
- `ui/` - React frontend
- `ios/` - the iPhone app
- `tests/` - unit, integration, and Playwright browser tests (`tests/browser/*.pw.ts`)
- `scripts/` - worktree setup, the performance check, and the proto check
- `config/apparmor/` - Bubblewrap AppArmor profile
- `docs/` - the API reference, a design proposal, and the codebase audit
- `data/` - default local data root, ignored by Git
