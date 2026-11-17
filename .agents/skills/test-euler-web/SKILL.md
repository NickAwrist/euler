---
name: test-euler-web
description: Test and verify changes to the Euler web app and server. Covers choosing between unit tests, the browser tests and their typed RPC mocks, the performance check, the scripted fixture servers, and the real dev server, running the Linux-only checks from the Mac, driving the app with Playwright, and calling an RPC by hand. Use for any web or server change that needs proof it works, a failing `bun test`, `bun run test:browser` or `bun run perf:check`, and any request to look at the running app.
---

# Testing the web app and server

Type checking and unit tests do not load stored chats through the API in a
browser. Run the change the way a user reaches it before calling it done.

## Pick the check

Use the cheapest one that would fail if the change were wrong.

| The change | Proof |
| --- | --- |
| Logic, a converter, a domain module | `bun test path/to/file.test.ts` |
| An RPC handler, validation, ownership | A case in `tests/e2e/`, through the in-process clients |
| A screen or interaction in the browser | `bunx playwright test tests/browser/<file>.pw.ts`, with a case for the new behavior |
| Rendering, the event stream, the transcript, bundle size | `bun run perf:check` on Linux as well |
| Spacing, color, alignment, motion | Before and after screenshots from the running app. No test. |
| Something only a real provider does | `bun run dev`, on the cheapest model that shows it |
| The iPhone app | The `test-euler-ios` skill |

`AGENTS.md` ("Refactoring and verification" and "Data and types") lists the
required pre-handoff checks and proto generation rules. `docs/development.md`
covers worktree setup and test suites.

## Linux and the Mac

Euler requires Linux for workspace file tools (`procfs`) and shell sandboxing,
so failures are expected when running server, workspace, and performance checks
on macOS. CI runs on Linux.

On Linux, run everything in the worktree. From a Mac, copy the working tree to
a temporary directory on a Linux machine you reach over ssh, and run there.
`<linux-host>` is that machine's ssh name. It comes from the user's own
instructions; ask the user if you can't find it.

```bash
R=$(ssh -o BatchMode=yes <linux-host> 'mktemp -d /tmp/euler-ci-XXXXXX')
# Without the two tar settings, macOS adds ._ files that Biome and bun test trip on.
git ls-files -z --cached --others --exclude-standard \
  | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf - \
  | ssh -o BatchMode=yes <linux-host> "cd $R && tar -xf -"
# A plain ssh command has no bun, bunx or node. The login shell and ~/.bun/bin add them.
run() { ssh -o BatchMode=yes <linux-host> "cd $R && PATH=\$HOME/.bun/bin:\$PATH bash -lc '$1'"; }
run 'bun install --frozen-lockfile && bun test'
run 'bun run test:browser'
run 'bun run build && bun run perf:check'
ssh -o BatchMode=yes <linux-host> "rm -rf $R"
```

The copy has your uncommitted edits and no `.git`. Without git, `bun run lint`
skips its proto compatibility check and still exits 0, so run lint in the
worktree. Remove the directory when you finish.

## Unit and API tests

`bunfig.toml` preloads `tests/setup.ts` for every `bun test` (in-memory
database, scripted providers). API tests call the handlers through the same
router options and interceptors as the HTTP mount, without a socket:

```ts
import { Code, rpc, rpcCode } from "../helpers/rpc";

const { sessions } = rpc();              // the test user
const other = rpc(crypto.randomUUID());  // someone else
expect(await rpcCode(other.sessions.getSession({ id }))).toBe(Code.NotFound);
```

`rpc(null)` sends no user header. `rpcError` returns the `ConnectError` when
the test reads its message or details.

`src/rpc/wire.ts` throws on an unknown stored kind or status (see
`docs/connect-api.md`). Seed test data through the runtime's own shapes, and
before shipping changes to those converters, read real stored chats through the
new handlers on the iOS test server's database (ask the user before reading
production's).

## Browser tests

Playwright starts Vite on port 5199, and each test mocks the RPCs its page
calls. The tests are `tests/browser/*.pw.ts`.

```bash
bunx playwright test tests/browser/usage.pw.ts
bunx playwright test -g "usage desktop"
```

A failure saves a screenshot under `.cache/browser-results/`. Read it first.

Two rules that are easy to miss:

- **A title picks the project.** `playwright.config.ts` runs a test only when
  its title matches the `grep` of the `mobile` or `desktop` project. A new
  test whose title matches neither never runs and never fails. Put a listed
  phrase in the title or add one to the `grep`, then confirm the test appears
  in `bunx playwright test --list`.
- **Mock RPCs with the typed helpers.** `mockApp(page, fixture)` in
  `tests/browser/appFixture.ts` serves a returning user's app: the chat list,
  stored chats, the model catalog and healthy providers. Add the RPCs a test
  exercises with `mockRpc(page, [on(Service.method.name, handler)])` from
  `rpcMock.ts`, after `mockApp`, because the route registered last answers
  first. Return `new RpcFailure("not_found", "…")` for an error. Never stub
  `**/api/**` with hand-written JSON or legacy REST shapes: Connect ignores
  unknown fields, so an untyped or wrong-shaped stub passes without testing the
  contract.

`mockUserPreferences(page)` keeps preferences in memory across saves.
`ui/main.tsx` defines the `/dev/...` fixture routes (`AGENTS.md` has the rules
for fixtures vs. final screenshots).

Tests that need the real server call `startAsyncBackend` in
`tests/browser/asyncBackend.ts`. It starts `tests/helpers/asyncFixture.ts`,
the real API on a scripted model with an in-memory database, and `useBackend`
sends the page's calls to it. `sessionLoading.pw.ts`, `jobs.pw.ts` and
`toolPermissionsLive.pw.ts` show the three modes.

## The performance check

```bash
bun run build && bun run perf:check
```

`perf:check` serves `dist/` without building it, so always run `bun run build`
first. `scripts/performance/README.md` covers what it measures, how
`answerInTurn` keeps concurrent RPC render counts deterministic, and when to
run `bun run perf:check --update`.

The last run's numbers are in `/tmp/euler-performance-check/check.json`. A
timeout waiting for text or a 500 in the output means a seeded chat failed to
load—read the `rpc.failed` lines above the error and ensure `fixture.ts` writes
records in the runtime's shapes (`RunContext.wireStep`).

## Run the app without a provider

The performance fixture is also the quickest whole app to look at. It serves
`dist/` (`bun run build` first), needs no key and no model, and deletes nothing
of yours.

```bash
bun run build
PERF_PORT=5307 LOG_LEVEL=error bun scripts/performance/fixture.ts > "$SCRATCH/fixture.log" 2>&1 &
echo $! > "$SCRATCH/fixture.pid"
until grep -q controlPort "$SCRATCH/fixture.log"; do sleep 0.5; done
head -1 "$SCRATCH/fixture.log"   # {"userId":…,"workspace":…,"controlPort":…,"longSessions":[…]}
```

`SCRATCH` is your scratchpad directory. The app is at
`http://127.0.0.1:5307`, on loopback only. A reply moves only when you push it
through the control port:

```bash
curl -X POST "http://127.0.0.1:$CONTROL/chunk" -d '{"content":"Hello."}'   # one piece of the reply
curl -X POST "http://127.0.0.1:$CONTROL/finish" -d '{}'                    # end the reply
curl "http://127.0.0.1:$CONTROL/streams"                                   # replies waiting, as {"open":n}
```

Hold a reply open to look at a state that lasts a moment, such as the Stop
button or streaming text. Stop the fixture with
`kill "$(cat "$SCRATCH/fixture.pid")"`, then delete the `workspace` directory
it printed. On macOS it runs, though Linux-only workspace features stay off.

The fake model says only what you push, so it never calls a tool or starts an
agent, and the fixture has no image or search provider. For those use the
real server.

## Driving the app

Write a short script in the scratchpad and run it with `node`. Import the
repository's Playwright by path, since a script outside the repository cannot
resolve it by name. Selectors by role and accessible name hold up. Class names
do not.

```js
const [repo, url, userId, out] = process.argv.slice(2);
const { chromium } = await import(`${repo}/node_modules/@playwright/test/index.mjs`);
const browser = await chromium.launch({ channel: "chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// The app reads its user from storage. Without this it opens onboarding as a new user.
await page.addInitScript((id) => {
  localStorage.setItem("euler:userUuid", id);
  localStorage.setItem(`euler:onboarding:${id}`, "complete");
}, userId);
await page.goto(url);
await page.getByPlaceholder("Send a message...").fill("Say hello");
await page.getByRole("button", { name: "Send message" }).click();
// The Stop button shows while the reply runs. On the fixture, push the reply here.
const stop = page.getByRole("button", { name: "Stop generation" });
await stop.waitFor();
await stop.waitFor({ state: "detached" });
// Messages fade in. Wait for the animations before the screenshot, or text captures half-transparent.
await page.waitForFunction(() =>
  document.getAnimations().every(
    (a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity,
  ),
);
await page.screenshot({ path: `${out}/after.png` });
console.log(errors);
await browser.close();
```

Names that hold across the app:

- The composer's box has the placeholder `Send a message...`. Its buttons are
  `Send message` and, while a reply runs, `Stop generation`.
- `Toggle chats` opens and closes the chat list sidebar. A chat there is a
  button named by its title.
- Typing `@` in the composer opens `#file-picker`, with one button per file.
- Settings has `Save settings`, which shows only when something changed.

For a phone, use
`{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }`.
The composer, sidebars and sheets lay out differently there, so check both
sizes for anything in them. Look at the screenshots yourself with the Read
tool, and send the user the ones that show the change.

Collect `pageerror` every time. A flow that looks right can still throw.

## The real dev server

`AGENTS.md` ("Running the app") covers worktree initialization, `.env` ports,
and what to verify before handing the server to the user.

- Replies from OpenRouter or a ChatGPT plan spend the user's money or quota;
  pick a local Ollama model when the change does not depend on the provider.
- Before using a dev server that is already running, confirm its working
  directory is this worktree. A port tells you nothing about who owns it.
- `http://<hostname>:<port>` is not a secure context, so `crypto.randomUUID`
  and `navigator.clipboard` can be missing there while they work on
  `127.0.0.1`. Check anything that uses them at the address the user will open
  (and see `docs/customization.md` under OAuth for MCP sign-in over plain HTTP).

## Calling an RPC by hand

Every call is a POST to `/api/rpc/euler.v1.<Service>/<Method>` with a JSON
body and the user's ID. The request and response fields are the proto's, in
camelCase.

```bash
curl -s -X POST http://127.0.0.1:<port>/api/rpc/euler.v1.SessionService/ListSessions \
  -H 'Content-Type: application/json' -H 'X-Euler-User-ID: <uuid>' -d '{}'
```

Without a valid header the answer is `invalid_argument`, which still proves
the server is up. For a deployed server, `scripts/rpc-smoke.ts` checks a unary
call and the event stream, and with `--chat <model>` streams a real reply:

```bash
bun scripts/rpc-smoke.ts http://<hostname>:<port> <uuid>
```

A failed call logs `rpc.failed` on the server with the stack. The fixtures run
with `LOG_LEVEL=error`, so those lines are all they print.

## Adding coverage

Test a behavior at one layer, the lowest one that fails without the change.
Add a case to the existing test before creating a file. A rule about one RPC
belongs in `tests/e2e/`. What the browser does with the answer belongs in a
browser test with that RPC mocked. Don't assert the same thing on both sides.
