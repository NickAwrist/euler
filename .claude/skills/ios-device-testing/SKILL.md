---
name: ios-device-testing
description: Test the Euler iOS app in the simulator and on the user's iPhone, deploy the iOS branch to the iOS test server on spaceheater, and debug push notifications and device crashes. Use for any iOS work that needs a running server, a build on the phone, a crash log, or a change to the server the phone talks to.
---

# iOS testing, the iPhone, and the iOS test server

iOS work happens on `t3/ios-app` (and branches merged into it). The phone talks
to a separate **iOS test server** on `spaceheater`, never to production. Read
`ios/README.md` for the app's layout and `docs/ios-connect-migration.md` for
what is built.

## Machines and servers

- **This Mac**: Xcode (team `66LT3G6V44`), the simulators, and the user's
  iPhone over USB. `ssh -o BatchMode=yes spaceheater …` works.
- **spaceheater** (Linux) runs two Eulers:

| Server | Runs | Files and data | Address |
| --- | --- | --- | --- |
| Production | deployctl service `deployctl-9ecaeef3-…-euler`, from `main` | `~/.deployctl/workloads/9ecaeef3-f295-4e84-a970-7732d04f89b5/` | `http://spaceheater:3100` |
| iOS test server | systemd user unit `euler-ios.service`, from `t3/ios-app` | `~/euler-ios/app` (a plain copy, no git), data in `~/euler-ios/data` | `http://spaceheater:3200` |

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

Deploy from a clean, committed branch that contains the deployed commit, so the
server never goes backwards.

```bash
# Quote remote paths: an unquoted ~ expands to this Mac's home.
DEPLOYED=$(ssh -o BatchMode=yes spaceheater 'cat ~/euler-ios/DEPLOYED_COMMIT')
git merge-base --is-ancestor "$DEPLOYED" HEAD || echo "HEAD does not contain the deployed commit: stop and ask"

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

```bash
xcrun devicectl list devices            # the phone's identifier; "available (paired)"
cd ios && bun run ios:project
xcodebuild -project Euler.xcodeproj -scheme Euler -destination 'id=<device id>' \
  -derivedDataPath build/DeviceData -allowProvisioningUpdates build
xcrun devicectl device install app --device <device id> \
  build/DeviceData/Build/Products/Debug-iphoneos/Euler.app
xcrun devicectl device process launch --device <device id> net.spaceheater.euler
```

- A launch that fails with "could not be unlocked" only means the phone is
  locked; ask the user to open the app.
- "Developer Mode disabled" or "Manual pairing … in progress": the user must
  turn on Developer Mode and tap Trust on the phone. You cannot.
- On first launch the app asks for the server (`http://spaceheater:3200`) and
  a user ID. The user scans it from the web at `http://spaceheater:3200`,
  Settings › General › Show QR. You cannot drive the phone's screen; ask.
- Install the app built from the commit the test server runs, so the client
  and server contracts match.

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

Drive simulator UI through the T3 device tools (`device_list`, `device_open`,
`device_screenshot`, and the `agent-device` command they return), not `simctl`
taps. If a simulator is held by another session, open a different one rather
than taking it over. Haptics, real push and the camera scanner need the iPhone.

A local dev server (`bun run dev`, ports from `.env`) is reachable from the
simulator at `http://127.0.0.1:<EULER_FRONTEND_PORT>`. The UI tests use the
scripted fixture backend instead; see `ios/README.md`.

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
