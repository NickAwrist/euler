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

## Data and types

- Put domain API operations in ui/persist/ and use ui/lib/api.ts for
  request handling. Choose user-scoped or global helpers explicitly.
  Avoid repeating endpoint strings and HTTP handling in components.
- Use ui/lib/safeStorage.ts for browser storage. Handle storage failure
  according to the caller's needs.
- Validate untrusted data at runtime boundaries using existing Zod
  patterns. Reuse contracts in src/schemas/ when server and UI share
  them. Type annotations and generic JSON helpers do not validate data.
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
- Review the diff for duplicated behavior, unnecessary abstractions,
  and competing sources of truth. Report checks actually run and
  any verification gaps.
