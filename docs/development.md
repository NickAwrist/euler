# Development

```bash
bun run dev          # backend and UI together
bun run dev:server   # backend only
bun run dev:ui       # Vite only
```

The backend API and the Vite UI are separate processes in development, and
Vite proxies `/api` to the backend. Their ports come from `.env`. See
[Configuration](configuration.md).

## Project structure

- `proto/`: the API contract. See [The Connect API](connect-api.md).
- `src/`: backend server, RPC handlers, agent loop, tools, and session storage
- `ui/`: React frontend
- `ios/`: the iPhone app
- `tests/`: unit, integration, and Playwright browser tests
- `scripts/`: worktree setup, iOS icon generation, the RPC smoke test, the
  performance check, and the proto check
- `config/apparmor/`: Bubblewrap AppArmor profile
- `docs/`: guides, the API reference, and the codebase audit
- `data/`: default local data root, ignored by Git

## Worktrees

From a new worktree:

```bash
bun run init:worktree
# Edit .env: set unused EULER_BACKEND_PORT and EULER_FRONTEND_PORT values.
bun run dev
```

`init:worktree` sets the worktree up from the primary checkout:

- It copies `.env`, or `.env.example` if there is none, and points
  `EULER_DB_PATH` and `EULER_DATA_ROOT` at the worktree's own `data/`.
- It links the primary checkout's `node_modules`. If the primary checkout has
  none, run `bun install --frozen-lockfile`.
- It copies a snapshot of the SQLite database and the retained workspaces.
- It doesn't copy the workspace trash or ChatGPT connections. Reconnect under
  **Settings > ChatGPT**.

Rerunning it keeps the existing `.env`, dependencies, and data, and it never
changes the primary checkout or other worktrees. The copied `.env` carries the
primary checkout's endpoints, API keys, and `EULER_HOST_DIRECTORY`, and those
values [override the copied Settings](configuration.md#environment-overrides).

You can also run `bun run init:worktree /path/to/worktree` from the primary
checkout. T3 Code can run the same command when it creates a worktree, through
its `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` variables.

## Checks

```bash
bun test
bunx tsc --noEmit
bun run lint
bun run build
bun run test:browser
```

`bun test` loads a test setup with an in-memory database and mocked services.
Dev instances use your real configuration.

Several checks need Linux, because the file and shell tools do. On macOS about
40 unit tests and one browser test fail.

CI builds the app and runs the
[performance check](../scripts/performance/README.md). It doesn't run the
other checks yet.

## Browser tests

```bash
bunx playwright install chromium --no-shell
bun run test:browser
```

The tests run Vite on port 5199, run mobile and desktop interactions, and save
screenshots in `.cache/browser-results/`. They need no display server. Test
files end in `.pw.ts` so `bun test` doesn't pick them up.

Outside CI the tests reuse a server already on port 5199, which may be another
worktree's. Stop it first.

The `/dev/...` routes are UI fixtures for these tests. Production builds
exclude them. To try one by hand, run `bun run dev:ui` and open
`/dev/messages`. It renders the real message components with in-memory
examples, so copying, editing, regenerating, switching reply versions, and
viewing traces work without a backend or model. Reload to reset.

## Sandbox tests

```bash
bun test tests/sandbox
```

Run it on a Linux host with working Bubblewrap namespaces to verify workspace
writes and network isolation. Without Bubblewrap most of these tests report
skips, and `tests/sandbox/background.test.ts` fails. On Ubuntu 24.04, see
[Bubblewrap on Ubuntu 24.04](workspaces.md#bubblewrap-on-ubuntu-2404).
