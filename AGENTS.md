# App engineering conventions

These conventions supplement the general engineering instructions.

## Reuse and ownership

- Before adding behavior, inspect nearby code and search for an existing
  component, hook, utility, schema, or persistence function that owns it.
- Reuse existing shared components, hooks, and utilities where applicable.
  Examples include Button, IconButton, RefreshButton, and Modal;
  these are not an exhaustive list.
- Keep recurring interaction and accessibility behavior in the shared
  abstraction that owns it rather than recreating it at call sites.
- Extend an existing abstraction when the responsibility is the same.
  Extract shared behavior when it removes meaningful duplication.
  Similar markup alone does not justify an abstraction.
- Keep domain behavior in domain components and hooks. Keep generic
  components independent of sessions, agents, workspaces, and runs.
- Build fields and options from the schema or catalog that already
  defines them, such as tool input schemas and the model catalog.
  Render tool results in the shape the tool returns; don't invent
  fields such as exit codes.

## UI copy

- Use short labels. Don't add helper subtext, sentence-length
  placeholders, or explanatory lines unless the user asks for them.
- Don't invent branding, icons, or marketing text.

## Running the app

- In a new worktree, run `bun run init:worktree` once, then `bun run dev`.
- Use the ports in the worktree's `.env`. Don't pass other ports on the
  command line: the user ID lives in browser storage per origin, so a new
  port opens an empty app.
- Give the user `http://spaceheater:<EULER_FRONTEND_PORT>` and leave the
  server running.
- Before handing it over, open it and confirm it shows the copied chats
  and a ready model provider. Values in `.env` override saved settings,
  so a stale key there breaks a provider that looks right in Settings.
- `/dev/...` routes are fixtures for browser tests. Final screenshots come
  from the running app. Label any fixture or mocked screenshot as such.

## Data and types

- The API contract is proto/euler/v1/. Change an RPC there, run
  `bun run proto`, and commit the generated code in src/gen/ and
  ios/EulerAPI/; `bun run lint` fails when it is stale. Handlers live in
  src/rpc/, one file per service, and call existing domain code.
- Put domain API operations in ui/persist/ and call the generated clients
  from ui/lib/rpc.ts. Avoid calling clients directly from components.
- Use ui/lib/safeStorage.ts for browser storage. Handle storage failure
  according to the caller's needs.
- API messages are decoded by the generated code and checked by
  buf.validate rules in the protos; put field rules there, and rules that
  need state in handlers. Validate other untrusted data (environment,
  files on disk, provider and MCP responses, tool input) with existing Zod
  patterns in src/schemas/. Type annotations and generic JSON helpers do
  not validate data.
- Put shared UI types in focused modules under ui/types/ and re-export
  them from ui/types/index.ts. Keep feature-local types in the feature's
  types.ts. Reuse existing contracts rather than copying their shapes.

## Refactoring and verification

- Preserve interaction behavior and edge cases during refactors.
  Make intentional behavior changes explicit and remove replaced code.
- Test behavior callers rely on when introducing or changing shared
  behavior, including relevant accessibility and failure cases.
- For code changes, run affected tests, type checking, and lint:
  - `bun test <affected test paths>`
  - `bunx tsc --noEmit`
  - `bun run lint`
- Run `bun run build` for changes affecting the UI build and
  `bun run test:browser` for browser interaction changes. Run the full
  relevant suites for broad changes.
- .claude/skills/test-euler-web/SKILL.md covers choosing a check, the
  checks that need Linux, the fixture servers, and driving the app in a
  browser. Read it before verifying web or server work.
- Review the diff for duplicated behavior, unnecessary abstractions,
  and competing sources of truth. Report checks actually run and
  any verification gaps.
- In the handoff, give net lines changed in src/, ui/, and tests/.
  Name each new component or hook and why an existing one didn't fit.

## iOS

- The iPhone app lives in ios/. Read ios/README.md before changing it and
  .claude/skills/test-euler-ios/SKILL.md before testing it, running it
  on a device, or deploying the iOS test server. The phone never points at production.
