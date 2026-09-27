# Experimental design mocks

Interactive mocks for design proposals under `docs/design/`. They use fictional data and local React state, and never call the server. `ui/main.tsx` lazy-loads them only in development.

| Mock | Route | Design |
| --- | --- | --- |
| [`async-agents/`](async-agents/README.md) | `/dev/experimental/async-agents` | [Async agents](../../docs/design/async-agents.md) |
| [`browser-use/`](browser-use/README.md) | `/dev/experimental/browser-use` | [Browser use](../../docs/design/browser-use.md) |

`shared/` holds the Euler-like shell, the one-line agent status row, and the screenshot helpers both mocks use.

## Open

```sh
bun run dev:ui --port 5203 --strictPort
```

## Validate and regenerate screenshots

```sh
bunx playwright test --config dev/experimental/playwright.config.ts
UPDATE_DESIGN_MOCKS=1 bunx playwright test --config dev/experimental/playwright.config.ts
```

The config starts Vite on port 5203 and needs no backend. Install Chromium with `bunx playwright install chromium` if it is missing. With `UPDATE_DESIGN_MOCKS=1`, tests write screenshots to `docs/design/<design>/` at 1440 × 1000. Without it, committed screenshots are left untouched. Each mock also checks every scene at 390 × 844 for horizontal overflow.

Keep experiments here until their production contracts are settled. Do not reuse mock state handling as a production implementation.
