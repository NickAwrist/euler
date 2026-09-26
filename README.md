# Euler

A local-first agent runtime with a run UI, powered by [Ollama](https://ollama.com/).

Every chat uses one agent with all built-in tools. It can hand self-contained
work to subagents, which share its tools and instructions but run in a fresh
context. Customize the system prompt under **Settings > General**.

Custom skills live under **Customization > Skills**. A skill follows the
`SKILL.md` shape: a lowercase hyphenated name, a description that tells agents
when to use it, and Markdown instructions. Agents receive only the skill
metadata until they load a matching skill. Type `$skill-name` in a message to
invoke one directly. **Import** reads a pasted `SKILL.md`, including the
`user-invocable` and `disable-model-invocation` frontmatter fields. Turn off
**Users can invoke** to hide a skill from `$skill-name`, or **Agents can load
automatically** to keep it out of the agent's skill list.

## Requirements

- [Bun](https://bun.sh/)
- [Ollama](https://ollama.com/) running locally

## Setup

```bash
bun install
```

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

Create your own local settings file, then edit it before starting the app:

```bash
cp .env.example .env
```

Bun and Vite load `.env` automatically. Restart the dev processes after changing it.
The file is ignored by Git. For example:

```bash
EULER_BACKEND_PORT=3000
EULER_BACKEND_HOST=127.0.0.1
EULER_FRONTEND_PORT=5174
EULER_OLLAMA_HOST=http://127.0.0.1:11434
EULER_COMFYUI_HOST=http://127.0.0.1:8188
EULER_SEARXNG_HOST=http://127.0.0.1:8080
```

Nonempty environment values always take precedence over saved settings and defaults.
Settings controlled by the environment are disabled in the UI. Remove the environment
value and restart the server to manage that setting through the UI. API requests that
change an environment-controlled setting are rejected; saving other settings still works.
Empty or whitespace-only optional values are treated as unset.

In development, the backend API and Vite UI are separate processes:

- `EULER_BACKEND_PORT` controls the API server. Default: `3000`.
- `EULER_FRONTEND_PORT` controls the Vite dev server. Default: `5174`.

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
Temporary workspaces and trash are not copied. Environment values
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
deployctl create git@github.com:NickAwrist/orbis-agents.git --name euler
deployctl deploy euler --build
```

In production, the backend server serves both the built UI and API from a single process on `EULER_BACKEND_PORT` (default `3000`).

`deployctl.yaml` specifies build commands and runtime service configuration:
- `build.commands`: installs dependencies and runs `bun run build` to generate `dist/`.
- `build.include`: packages `package.json`, `bun.lock`, `tsconfig.json`, `src`, `dist`, and `node_modules` into the immutable release directory.
- `services.euler`: executes `bun run src/server.ts` supervised by systemd.

Persistent application data (SQLite database and workspaces) is stored in `DEPLOYCTL_DATA_DIR`, which deployctl provides and preserves across releases.

To update and redeploy:

```bash
deployctl update euler
deployctl deploy euler --build
```

Manage environment variables with `deployctl env`:

```bash
deployctl env set euler EULER_BACKEND_PORT=3100
deployctl restart euler
```

## Workspaces

Shell commands and file tools use `/workspace` for both private and selected
local workspaces. File tools also accept relative paths within that directory.
The UI shows the selected host directory for local workspaces.

Workspace file operations require Linux with procfs. Reads, writes, directory
listing, and scans open path components without following symlinks. Deletes use
an open parent directory and unlink the final entry without following it. Ignore
rules are read only from within the workspace through the same protected access.

Temporary workspaces expire after 24 hours. The server checks for expired leases
and abandoned directories every minute, deferring deletion during active turns.
Leaving a temporary chat requests deletion immediately. Selected local directories
are never removed by temporary workspace cleanup.

The sandbox integration tests report skips when Bubblewrap is unavailable. Run
`bun test --preload ./tests/setup.ts tests/sandbox` on a Linux host with working
Bubblewrap namespaces to verify workspace writes and network isolation.

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
using its filesystem restrictions and isolated network namespace.

Restart the backend after loading the profile because it caches the sandbox
capability check. Then run the sandbox tests above; workspace writes and network
isolation tests should run rather than skip.

## Message UI demo and browser checks

Run `bun run dev:ui` and open `/dev/messages` on the Vite server. The demo uses
real message components with in-memory examples for single-line, multiline, and
scrolling code. Hold a user message for its actions; tap the dots beside an assistant reply.
Copy, edit, retry confirmation, and trace viewing work without a
backend or model. Reload to reset the examples. The route and fixtures are
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

## Project Structure

- `src/` - backend server, agent loop, tools, and session storage
- `ui/` - React frontend
- `data/` - local persisted data
