# The Connect API

Every call the web app and the iPhone app make is an RPC defined in
`proto/euler/v1/` and served by [Connect](https://connectrpc.com/) at
`/api/rpc`. The Express app mounts it before any JSON body parser. Two plain
GET routes remain, for `<img src>`: ComfyUI outputs and favicons.

## Contract and generated code

- `bun run proto` runs buf, which writes TypeScript to `src/gen/` and Swift to
  `ios/EulerAPI/Sources/EulerAPI/Generated/`. Both are committed.
- `bun run lint` runs buf lint, buf breaking against `origin/main`, and a check
  that the committed code matches a fresh generation.
- Handlers live in `src/rpc/`, one file per service, and call the domain code.
  `src/rpc/wire.ts` converts between the runtime's records and the generated
  messages. `src/schemas/` holds stored data and domain values, not API shapes.
- The web app's `ui/persist/` modules call the generated clients through
  `ui/lib/rpc.ts`, with JSON so requests are readable in DevTools. The iPhone
  app uses binary.
- API tests call the handlers through in-process Connect clients
  (`tests/helpers/rpc.ts`). Browser tests mock RPCs with typed fixtures
  (`tests/browser/rpcMock.ts`).

## Requests and errors

Interceptors in `src/rpc/interceptors.ts` run on every call:

- `x-euler-user-id` must be a valid user ID. It separates users' data and does
  not prove identity.
- `buf.validate` rules in the protos are enforced. A CEL rule whose ID starts
  with `euler.` carries the message people see.
- Euler error codes map to Connect codes, with the Euler code attached as an
  `ErrorDetail` (`src/rpc/errors.ts`).

A failure the server explains shows its message in the UI. Any other, such as
a dropped connection or a proxy error, shows the caller's fallback
(`withErrorMessage` in `ui/lib/rpc.ts`).

Things that differ from a hand-written JSON API:

- **Unknown fields.** Connect ignores fields a message doesn't define, so a
  request that sets a field the API lacks is a no-op, not an error.
- **64-bit numbers.** protobuf-es ignores `jstype = JS_NUMBER`, so 64-bit
  fields are `bigint` in TypeScript. Counts that fit use `uint32`: tokens,
  image size, context length. Sequences, message IDs, and file and model sizes
  stay 64-bit. Usage aggregates are `double`.
- **Strict reads.** The converters throw on a stored kind or status they don't
  know, which fails the whole response. See `TYPE-1` in
  [the audit](audit-issues.md).

A few RPCs worth knowing:

- `WorkspaceService.RevealFile` requires a loopback socket and a loopback last
  `X-Forwarded-For` hop. The Vite proxy sets `xfwd` for this.
- `WorkspaceService.DownloadFile` streams a file from sandbox and local
  workspaces alike.
- `McpServerService.CreateServers` takes the pasted config text.
- `ProviderService.GetOpenRouterCatalog` has no side effects.
  `RefreshOpenRouterCatalog` fetches the catalog again.

## Event stream

`EventService.Subscribe` is a server stream of a user's agent events across
all chats. Each event has a per-user sequence. A client reconnects with the
last sequence it applied as `after_sequence`, and the hub replays what it
missed from a buffer of 2000 events or 4 MB. When the buffer has moved past
that point the stream starts with `Resync`, and the client fetches
`AgentService.GetRuntime` again. `Keepalive` arrives after five idle seconds
and is not replayed. `ApprovalRequested` and `ApprovalResolved` carry tool
approvals.

## Push

`DeviceService` stores APNs tokens per user. With `APNS_KEY_FILE`,
`APNS_KEY_ID`, and `APNS_TEAM_ID` set, the server signs requests with the .p8
key. It pushes when a main agent's turn finishes or fails, and when any agent
asks to run a tool. Approval pushes carry Allow once and Deny actions, and the
notification service extension attaches a reply's generated image.

Devices register per user, so a push reaches all of a user's phones. The
server skips them all while any client of that user holds the event stream
open, including a web tab left open. Code: `src/notifications/` and
`src/rpc/devices.ts`.

## The iPhone app

[`ios/README.md`](../ios/README.md) covers the app. It targets iOS 26.0 and
bundles the web's font files from `public/fonts/`. Two things render
differently from the web:

- The web's Default font, IBM Plex Sans, is not bundled on either client. On
  iOS it maps to the system font.
- An equation alone in its paragraph is a centered block on iOS. The web
  renders a single-line `$$…$$` inline.

The phone talks to a separate iOS test server on spaceheater, never to
production. Deploying it, running the app on a device, and push checks are in
`.claude/skills/test-euler-ios/SKILL.md`.
