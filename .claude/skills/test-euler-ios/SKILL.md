---
name: test-euler-ios
description: Test and verify changes to the Euler iPhone app. Covers choosing between the Swift unit tests, the UI tests on the fixture backend, the simulator and the user's iPhone, deploying a branch to the iOS test server on spaceheater, push notification checks, and device crash logs. Use for any iOS change that needs proof it works, and for any server or proto change the phone has to test against.
---

# Testing the iPhone app

The iPhone app in `ios/` is a client of the same Connect API as the web app.
While a change is in progress, the simulator and the phone talk to a separate
**iOS test server** on `spaceheater` that runs the branch, never to
production. The phone has two apps side by side: **Euler - Dev** (scheme
`EulerDev`, `net.spaceheater.euler.dev`) for the test server, and **Euler**
(scheme `Euler`, `net.spaceheater.euler`) for production. Branches install
only as Euler - Dev; Euler is installed from `main` when shipping. Read `ios/README.md` for the app's layout and
`docs/connect-api.md` for the API, the event stream and push. The web app and
the server have their own skill, `test-euler-web`.

## Pick the check

| The change | Proof |
| --- | --- |
| The reducer, stream reconnects, Markdown, math, composer logic | The unit tests, on a simulator |
| A flow through several screens | The UI tests, on the fixture backend |
| Layout, color, motion | Screenshots from a simulator through the T3 device tools |
| A proto or server change the app depends on | Deploy the branch to the test server, then run the app against it |
| Push, haptics, the camera scanner, a crash on the device | The iPhone. The simulator has none of them. |

## The usual loop

1. Contract changes: edit `proto/euler/v1/`, run `bun run proto`, and commit
   the TypeScript and Swift it writes. Update the handler, the web's callers
   and the iOS stores and views in the same change.
2. Run the unit tests on a simulator, and the checks in `test-euler-web` for
   the server and the web app.
3. Commit, then deploy the branch to the iOS test server.
4. Run Euler - Dev on a simulator or the iPhone, pointed at the test server,
   and check the changed flow there.

## Machines and servers

- **This Mac**: Xcode (team `66LT3G6V44`), the simulators, and the user's
  iPhone over USB. `ssh -o BatchMode=yes spaceheater …` works.
- **spaceheater** (Linux) runs two Eulers:

| Server | Runs | Files and data | Address |
| --- | --- | --- | --- |
| Production | deployctl service `deployctl-9ecaeef3-…-euler`, from `main` | `~/.deployctl/workloads/9ecaeef3-f295-4e84-a970-7732d04f89b5/` | `https://euler.tail95018.ts.net`, a Tailscale Service in front of `http://spaceheater:3100` |
| iOS test server | systemd user unit `euler-ios.service`, from the branch under test | `~/euler-ios/app` (a plain copy, no git), data in `~/euler-ios/data` | `https://spaceheater.tail95018.ts.net:3201`, a Tailscale Serve entry in front of `http://spaceheater:3200` |

**Never restart, edit, or read secrets out of production, its environment
file, or its data.** The test server's database started as a copy of
production and is never synced back.

The test server's layout under `~/euler-ios/`:

- `app/`: the deployed tree, with `bun run build` output in `dist/` (it serves
  the branch's web app too, so web and iPhone share one address and database).
- `app/.env`: `EULER_BACKEND_PORT=3200`, `EULER_BACKEND_HOST=0.0.0.0`,
  `EULER_SERVE_FRONTEND=true`, `EULER_DB_PATH` and `EULER_DATA_ROOT` under
  `~/euler-ios/data`, the `APNS_*` lines, and the provider keys. Keep a backup
  before editing it; never print it.
- `apns/AuthKey_353ZGVLXL9.p8`: the team's APNs key. Never copy it into the repo
  or print it.
- `DEPLOYED_COMMIT`: the commit the server runs. Update it on every deploy.
- `ci/`: a scratch copy for running `bun test` and Playwright on Linux.

ChatGPT connections are not copied with the data; reconnect in Settings ›
ChatGPT.

## Deploy the branch to the test server

Deploy from a clean, committed branch. The server must never go backwards, and
deploying over another branch's work drops it. Deploy when the server's commit
is in your branch's history, or is already on `origin/main` and your branch
contains `origin/main`. Otherwise stop and ask the user.

```bash
# Quote remote paths: an unquoted ~ expands to this Mac's home.
DEPLOYED=$(ssh -o BatchMode=yes spaceheater 'cat ~/euler-ios/DEPLOYED_COMMIT')
git fetch -q origin main
git merge-base --is-ancestor "$DEPLOYED" HEAD \
  || { git merge-base --is-ancestor "$DEPLOYED" origin/main && git merge-base --is-ancestor origin/main HEAD; } \
  || echo "The server runs work this branch does not contain: stop and ask"

# Files the branch deleted since the last deploy; tar does not remove them.
git diff --name-only --diff-filter=D "$DEPLOYED" HEAD \
  | ssh -o BatchMode=yes spaceheater 'cd ~/euler-ios/app && xargs -r rm -f --'

git archive HEAD | ssh -o BatchMode=yes spaceheater '
  set -e
  cd ~/euler-ios/app
  tar -x -C .
  ~/.bun/bin/bun install --frozen-lockfile
  PATH=$HOME/.bun/bin:$PATH bun run build
  systemctl --user restart euler-ios.service
'
git rev-parse HEAD | ssh -o BatchMode=yes spaceheater 'cat > ~/euler-ios/DEPLOYED_COMMIT'
```

Then verify before handing the server off:

```bash
bun scripts/rpc-smoke.ts http://spaceheater:3200 <user id>                 # list + event stream
bun scripts/rpc-smoke.ts http://spaceheater:3200 <user id> --chat gemma4:e4b # streams a real reply
ssh -o BatchMode=yes spaceheater 'systemctl --user is-active euler-ios.service \
  deployctl-9ecaeef3-f295-4e84-a970-7732d04f89b5-euler.service; ss -ltn | grep -E ":(3100|3200) "'
```

Both units must be active, production still on 3100, the test server on 3200.

## The app on the iPhone

Euler - Dev, from the branch under test:

```bash
xcrun devicectl list devices            # the phone's identifier; "available (paired)"
cd ios && bun run ios:project
xcodebuild -project Euler.xcodeproj -scheme EulerDev -destination 'id=<device id>' \
  -derivedDataPath build/DeviceData -allowProvisioningUpdates build
xcrun devicectl device install app --device <device id> \
  build/DeviceData/Build/Products/Dev-iphoneos/Euler.app
xcrun devicectl device process launch --device <device id> net.spaceheater.euler.dev
```

When shipping, Euler is built the same way from the `main` checkout at
`origin/main`, with `-scheme Euler`, installed from
`Debug-iphoneos/Euler.app`, and launched as `net.spaceheater.euler`. It points
at production. Never install a branch as Euler.

- Signing runs outside the command sandbox; inside it, xcodebuild reports
  "No Accounts".

- A launch that fails with "could not be unlocked" only means the phone is
  locked; ask the user to open the app.
- "Developer Mode disabled" or "Manual pairing … in progress": the user must
  turn on Developer Mode and tap Trust on the phone. You cannot.
- On first launch the app asks for the server and a user ID: Euler - Dev uses
  `https://spaceheater.tail95018.ts.net:3201`, Euler uses
  `https://euler.tail95018.ts.net`. The user scans
  it from the web at that address, Settings › General › Show QR. You cannot
  drive the phone's screen; ask.
- Install Euler - Dev built from the commit the test server runs, so the
  client and server contracts match.

### Crash logs from the phone

```bash
xcrun devicectl device info files --device <device id> --domain-type systemCrashLogs | grep Euler
xcrun devicectl device copy from --device <device id> --domain-type systemCrashLogs \
  --source Euler-<date>.ips --destination <scratchpad>/crash.ips
```

An `.ips` file is one JSON header line, then a JSON body. The triggered
thread's frames name the failing symbol:

```bash
python3 - <scratchpad>/crash.ips <<'EOF'
import json, sys
d = json.loads(open(sys.argv[1]).read().split('\n', 1)[1])
print(d.get('exception'), d.get('asi'))
for t in d['threads']:
    if t.get('triggered'):
        for f in t['frames'][:25]:
            print(d['usedImages'][f['imageIndex']].get('name'), f.get('symbol'))
EOF
```

## Simulator

`Euler.xcodeproj` is generated and never committed. Run `bun run ios:project`
first, and again after every pull.

Other sessions keep simulators booted. Run tests on one that is shut down, and
name it by ID so two with the same name cannot be confused:

```bash
xcrun simctl list devices available | grep iPhone    # pick one marked (Shutdown)
cd ios && xcodebuild test -project Euler.xcodeproj -scheme Euler \
  -destination 'id=<simulator id>' -derivedDataPath <scratchpad>/ios-derived \
  -only-testing:EulerTests
```

The first build compiles the Swift packages and takes several minutes. The
result is the line `Test run with <n> tests in <m> suites passed`. The
XCTest summary above it reads "Executed 0 tests" because the suite is Swift
Testing, which is not a failure.

The UI tests (`-only-testing:EulerUITests`) need the scripted fixture backend
on port 5195, which has no real model. `LiveServerTests` run against a real
server when two environment variables name it. Both commands are in
`ios/README.md` under Tests.

Drive simulator UI through the T3 device tools (`device_list`, `device_open`,
`device_screenshot`, and the `agent-device` command they return), not `simctl`
taps. If a simulator is held by another session, open a different one rather
than taking it over. Haptics, real push and the camera scanner need the iPhone.

A local dev server (`bun run dev`, ports from `.env`) is reachable from the
simulator at `http://127.0.0.1:<EULER_FRONTEND_PORT>`.

## MCP sign-in

Authorize needs the server at an HTTPS address the simulator or phone can
reach. Against plain `http://spaceheater:3200` the app answers "Sign-in needs
Euler at an HTTPS address." and opens nothing. The test server's HTTPS
address works. To test a sign-in without deploying there:

- Run the branch on a spare port on spaceheater, bound to loopback, with its
  own `EULER_DB_PATH` and `EULER_DATA_ROOT` and `EULER_PUBLIC_URL` set to the
  address below.
- Check `tailscale serve status`, add
  `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`, and point the
  app at `https://spaceheater.<tailnet>.ts.net:<port>`. Remove the entry with
  `tailscale serve --https=<port> off` when done.
- `startOAuthMcpTestServer` in `tests/helpers/mcpServer.ts` is an OAuth MCP
  server without a sign-in page. Wrap it with an `/authorize` route that
  redirects to `approveAuthorization(request.url)`, and bind it to `0.0.0.0`
  so the simulator's sheet reaches it.
- The system asks before the sheet opens: `alert accept`. The page in the
  sheet is outside the app's accessibility tree, so tap it by coordinates
  taken from a screenshot.

## Push notifications

The server pushes when a main agent's turn finishes or fails, and when any
agent asks to run a tool, to every device the user registered, unless a client
holds the event stream open (the app does only in the foreground). Approval
notifications carry Allow once and Deny actions. Code:
`src/notifications/` and `ios/Euler/App/PushNotifications.swift`.

```bash
# Did the server send, skip, or fail?
ssh -o BatchMode=yes spaceheater 'journalctl --user -u euler-ios.service --since "-30min" --no-pager | grep -E "push\."'
# push.enabled: the key loaded at startup. push.sent: APNs accepted it.
# push.rejected: APNs refused (reason; a dead token deletes the device).
# No line: the app was in front, notifications are off, or the device never registered
# (look for DeviceService/RegisterDevice in the log).
```

Is the key accepted by Apple? A push to a fake token must answer
`400 BadDeviceToken` (403 means the key, key ID or team is wrong):

```bash
ssh -o BatchMode=yes spaceheater 'cd ~/euler-ios/app && ~/.bun/bin/bun -e "
const { readFileSync } = require(\"node:fs\");
const { createPrivateKey } = require(\"node:crypto\");
const { createProviderToken } = await import(\"./src/notifications/apns.ts\");
const http2 = require(\"node:http2\");
const key = createPrivateKey(readFileSync(process.env.APNS_KEY_FILE, \"utf8\"));
const jwt = createProviderToken(key, process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID);
const s = http2.connect(\"https://api.sandbox.push.apple.com\");
const r = s.request({ \":method\": \"POST\", \":path\": \"/3/device/\" + \"00\".repeat(32),
  authorization: \"bearer \" + jwt, \"apns-topic\": \"net.spaceheater.euler\", \"apns-push-type\": \"alert\" });
let status, body = \"\";
r.on(\"response\", (x) => { status = x[\":status\"]; });
r.on(\"data\", (d) => { body += d; });
r.on(\"end\", () => { console.log(status, body); s.close(); });
r.end(JSON.stringify({ aps: { alert: \"test\" } }));
"'
```

Debug builds register for the APNs sandbox; TestFlight builds for production.
Notification delegate methods use the completion-handler forms, which UIKit
calls on the main thread.

## Production rollout (only when the user asks)

Push reaches production only after the branch merges to `main` and deployctl
deploys it. Production then needs the key and the three `APNS_*` settings.
Ask the user before touching anything under `~/.deployctl`.
