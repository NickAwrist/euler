# iOS app and Connect RPC migration

Status of the plan "Euler iOS App and Connect RPC Migration" (Nov 8, 2026) on
`t3/ios-app`: what was built, where it departs from the plan, and what is still
unverified.

## Built

**Connect migration (A).** Every `/api` call is an RPC in `proto/euler/v1/`,
served by Connect at `/api/rpc` from the Express app, before any JSON body
parser. `bun run proto` runs buf, which writes TypeScript to `src/gen/` and
Swift to `ios/EulerAPI/`; both are committed, and `bun run lint` runs buf lint,
buf breaking against `origin/main` (once `main` has protos) and a freshness
check. Handlers live in `src/rpc/`, one file per service; interceptors validate
`x-euler-user-id`, enforce `buf.validate` rules (CEL rules with `euler.` IDs
carry the message people see), and map Euler error codes to Connect codes with
the Euler code as an `ErrorDetail`. `EventService.Subscribe` replaces the SSE
route and adds `Keepalive` (5 s), `ApprovalRequested` and `ApprovalResolved`.
Only two GET routes remain, for `<img src>`: ComfyUI outputs and favicons.
The web app's persist layer calls the generated clients through `ui/lib/rpc.ts`;
components kept their structure. API-only Zod schemas are gone; `src/schemas/`
holds stored data and domain values. Tests call handlers through in-process
Connect clients, and browser tests mock the RPCs with typed fixtures
(`tests/browser/rpcMock.ts`) while keeping their assertions. Web Settings ›
General gained Show QR.

**Push.** `DeviceService` stores APNs tokens per user. With `APNS_KEY_FILE`,
`APNS_KEY_ID` and `APNS_TEAM_ID` set, the server signs requests with the .p8
key and pushes when a main agent's turn finishes or fails, and when any agent
asks to run a tool, unless the user has an event stream open. Approval pushes
carry Allow once and Deny actions; a reply's generated image is attached by the
notification service extension.

**iOS app (B).** See `ios/README.md`. Onboarding (paste, QR scan, or new ID),
the chat list (swipe to rename and delete, pull to refresh, expiry), the
transcript (Markdown with tables and task lists, SwiftMath, highlighted code,
thinking, trace, generated images, sources), streaming coalesced per display
frame, the composer (model and thinking menus, photos, camera, paste, `$skill`,
`@file` and `/tool` suggestions, queueing), stop, deliver, remove queued, edit
and regenerate with a version pager, approval cards, agents and jobs, workspace
with a server directory browser, artifacts (Markdown and images native, HTML in
a web view with JavaScript off), every settings page, usage charts, haptics,
and push.

**iOS test server.** `euler-ios.service` on spaceheater, port 3200, data in
`~/euler-ios/data` (a copy of production taken once), push on. Deploy and
debugging steps are in `.claude/skills/ios-device-testing/SKILL.md`.

## Departures from the plan

- **64-bit numbers.** protobuf-es v2 ignores `jstype = JS_NUMBER`, so 64-bit
  fields are `bigint` in TypeScript. Counts that fit use `uint32` (tokens, image
  size, context length); sequences, message IDs and file and model sizes stay
  64-bit. Usage aggregates are `double`.
- **One migration, not one PR per service.** The event reducer couples events,
  runtime snapshots and sessions, so rows 1 to 13 landed together, each with
  its tests, rather than as thirteen PRs with REST and Connect side by side.
- **Generated Swift path.** `ios/EulerAPI/Sources/EulerAPI/Generated/`, as the
  plan's project layout has it (the plan's prose says `ios/EulerKit/`).
- **Deployment target iOS 26.0**, the newest the provided simulators run.
- **Contract details.** `DownloadFile` serves local workspaces too, as the
  artifact route did. Unused OpenRouter GET routes were dropped. MCP
  `CreateServers` takes the pasted config text. The OpenRouter catalog read
  (`GetOpenRouterCatalog`, side-effect free) is separate from
  `RefreshOpenRouterCatalog`, as the GET and POST routes were.
- **Unknown JSON fields.** Connect ignores fields a message doesn't define, so a
  request that sets a field the API lacks is a no-op rather than a 400.
- **Loopback check.** `RevealFile` requires a loopback socket and a loopback
  last `X-Forwarded-For` hop; the Vite proxy sets `xfwd`.
- **Error wording.** Failures the server explains show its message; others
  (a dropped connection, a proxy error) show the caller's fallback, as before
  (`withErrorMessage` in `ui/lib/rpc.ts`).
- **Push recipients.** Devices register per user, so a push reaches all of a
  user's phones; the server skips them all while any client of that user holds
  the event stream, including a web tab left open.
- **Fonts.** The app bundles the web's font files from `public/fonts/`. The
  web's Default font (IBM Plex Sans, not bundled on the web either) maps to the
  system font.
- **Display math.** An equation alone in its paragraph renders as a centered
  block on iOS; the web renders single-line `$$…$$` inline.

## Verified

- `bun test` (all pass on Linux; macOS fails only the baseline environment
  tests that need Linux), `bunx tsc --noEmit`, `bun run lint`, `bun run build`.
- `bun run test:browser`: every test passes; `jobs.pw.ts` needs Linux and
  passes on spaceheater, as on `main`.
- iOS unit tests (38) and UI tests (onboarding, a turn with a tool approval, a
  photo attachment, a theme change) on the iPhone 17 simulator.
- In the simulator against a local server: the chat list and stored chats from
  a copy of production, a real streamed reply with thinking, inline and display
  math and a table.
- The iOS test server: web app, RPCs and a streamed turn over the tailnet
  (`scripts/rpc-smoke.ts`), and Apple accepting its APNs key.
- The app builds, installs and launches on the user's iPhone.

## Not yet verified

- Onboarding on the iPhone and a turn there, which need the user to scan the
  QR code (Settings › General › Show QR at `http://spaceheater:3200`).
- A real push delivered to the phone, its Allow and Deny actions, and the
  attached image, which need a registered phone in the background.
- The QR scanner (VisionKit needs a camera) and haptics, which need the phone.
- The plan's per-phase manual phone gates, for the same reason.
