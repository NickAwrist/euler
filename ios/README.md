# Euler for iPhone

A SwiftUI client of the Connect API in `proto/euler/v1/`. It covers chatting
(transcript, streaming, composer, approvals, agents and jobs, workspaces,
artifacts), every settings page the web has, and push for finished turns and
tool approvals. iPhone only; iOS 26 and later.

## Setup

```bash
brew install xcodegen          # once
bun run ios:project            # after every pull: generates Euler.xcodeproj
open ios/Euler.xcodeproj
```

`Euler.xcodeproj` is generated from `project.yml` and never committed. Signing
uses team `66LT3G6V44`.

## Layout

| Path | What lives there |
| --- | --- |
| `project.yml` | Targets, signing, capabilities (push, app group), packages, Info.plist keys. |
| `EulerAPI/` | Only the generated contract. `bun run proto` at the repo root rewrites `Sources/EulerAPI/Generated/`. |
| `Euler/App/` | Entry point, root view, `AppSession` (one per signed-in user), push. |
| `Euler/Core/` | Backend client and user header, identity and Keychain, the event stream and its reducer, Markdown and math, theme and fonts, image pipeline. |
| `Euler/Features/` | One folder per screen: Chats, Chat, Composer, Onboarding, Settings, Usage. |
| `EulerNotificationService/` | Attaches a reply's generated image to its notification. |
| `EulerTests/` | Swift Testing: the reducer, stream reconnects, streaming coalescing, Markdown and math, composer logic. |
| `EulerUITests/` | XCUITest flows against the scripted fixture backend. |

The web's fonts in `public/fonts/` are bundled as they are and registered at
launch, so both clients render the same faces.

## How it works

- **Client.** `Backend` holds one Connect `ProtocolClient` (binary encoding) at
  `<server>/api/rpc`. `UserHeaderInterceptor` sends `x-euler-user-id`.
- **Events.** `EventStream` keeps `EventService.Subscribe` open in the
  foreground and resumes after the last sequence it saw. `RuntimeState` is a
  port of the web's `applyEvent` (ui/hooks/run/useAgentEvents.ts); keep the two
  in step. The stream closes in the background, which is how the server knows
  to push.
- **Streaming.** `ChatStore` publishes each part of a chat separately, and
  `LiveReply` publishes token text at most once per display frame, so a long
  transcript doesn't redraw per token.
- **Markdown.** swift-markdown (cmark-gfm) parses replies; single newlines are
  line breaks, as with remark-breaks. `MathDelimiters` ports the web's math
  policy, and SwiftMath typesets math; formulas it can't typeset show as source.
- **Identity.** The server address lives in defaults, the user ID in the
  Keychain. Onboarding takes a pasted ID, a scanned QR (web Settings › General ›
  Show QR) or a new one.

## Tests

```bash
cd ios
xcodebuild test -project Euler.xcodeproj -scheme Euler \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:EulerTests
```

The UI tests need the fixture backend, which has no real model:

```bash
JOB_FIXTURE_PORT=5195 TOOL_PERMISSION_FIXTURE=1 bun tests/helpers/asyncFixture.ts &
cd ios && xcodebuild test -project Euler.xcodeproj -scheme Euler \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:EulerUITests
```

`LiveServerTests` run against a real server when `EULER_LIVE_SERVER` and
`EULER_LIVE_USER` are set (pass them as `TEST_RUNNER_EULER_LIVE_SERVER` and
`TEST_RUNNER_EULER_LIVE_USER` to xcodebuild).

Running on the iPhone, the iOS test server and push are in
`.claude/skills/ios-device-testing/SKILL.md`.
