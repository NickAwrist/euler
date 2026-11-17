# Performance check

CI runs `bun run perf:check` against the production build. The check drives
the real React bundle, Express API, and SQLite in a phone-sized Chromium, with
a temporary database and workspace. It then compares what it measured with
`baseline.json`.

## Running locally

```bash
bunx playwright install chromium --no-shell
bun run build
bun run perf:check
```

The check needs Node.js as well as Bun, and Linux, because the file
suggestions read a sandbox workspace. It writes its results to
`/tmp/euler-performance-check`.

To see whether a count depends on machine speed, run it on two cores with
`taskset -c 0,1 bun run perf:check`.

## Fixture

- 100 chats, two of them 200 messages long with Markdown, code blocks, and
  tool steps. The check opens one of the long chats.
- A fake Ollama streams replies one token at a time through a loopback control
  port. No model runs, and the check observes each token before the next
  arrives.
- The app's bundled Geist and Geist Mono fonts, loaded before measuring.
  System fonts have different glyph widths across hosts, which changes message
  heights and the virtual rows mounted at each scroll step.
- Eight files in each long chat's real sandbox workspace. Autocomplete types
  `@src/perf` and waits for those eight suggestions. The 150 ms debounce should
  turn that typing burst into one request.
- Links to `example.com` get a local PNG through Playwright routing, so
  scrolling exercises image previews without external network timing.

## Metrics

The check gates on counts, not milliseconds. Wall-clock timings on shared CI
runners vary by more than the regressions worth catching. Lower is better for
every metric:

| Metric | What a regression means |
| --- | --- |
| `idle.domNodes` | The open chat or sidebar mounts more elements |
| `idle.animations` | Something animates while nothing happens |
| `health.rendersPerPoll` | An unchanged Ollama health report re-renders its consumers |
| `scroll.renders` | Scrolling the whole conversation renders more than the messages it mounts |
| `typing.renders` | Typing in the composer renders more than the composer |
| `autocomplete.renders` | File-reference typing and loading suggestions render more components |
| `autocomplete.requests` | A burst of file-reference typing sends more workspace requests |
| `stream.renders` | A streamed token renders more than the live reply (50 tokens) |
| `finishReply.renders` | Completing a reply re-renders the existing history |
| `openChat.renders` | Switching to another long chat renders more components |
| `bundle.jsGzipBytes`, `bundle.cssGzipBytes` | The scripts and styles the app loads grew |
| `api.sessionResponseBytes`, `api.sessionsResponseBytes` | Chat and chat-list payloads grew |

`bundle.jsGzipBytes` counts only scripts the app loaded during the check.
Shiki ships a lazy chunk per language, and summing them all would measure
grammars no user downloads.

Wall-clock medians under 4× CPU throttling go to the CI job summary for trend
reading and are never gated: idle main-thread time, typing and streaming
main-thread time, worst frame, and worst typing interaction.

CI uploads the raw results as an artifact. The artifact also records the
resolved text and code fonts and, per scroll step, the cumulative render
count, row mount counts, mounted rows, row heights, and scroll geometry, to
diagnose differences between hosts.

## How the counts stay repeatable

- **Renders, not commits.** The check counts renders through the DevTools
  global hook, which production React calls on every commit. Each component
  React rendered counts once. Renders are what a broken memo or an unstable
  prop multiplies.
- **Quiescent windows.** Each measurement window starts and ends with images
  and fonts loaded, finite CSS animations finished, and renders and scroll
  geometry unchanged across three two-frame samples. Image load, intersection,
  and resize callbacks finish before the next action. The Ollama health poll
  is held during every window that doesn't measure it.
- **One token at a time.** Streaming waits for each token to render before
  sending the next, so a slower machine can't batch tokens into fewer commits.
- **Calls answered in turn.** When an action sends concurrent RPCs (such as
  `GetSession` and `GetRuntime` when opening a chat, or overlapping list
  refreshes), racing answers can land in one React commit on some runs and
  separate commits on others. `answerInTurn` releases each answer only after the
  page has rendered the one before.
- **Scroll.** The count pass crosses the thread from bottom to top in 200
  settled steps. It covers small scroll steps, not remount work during large
  jumps. A separate 40-step pass without the settling waits reports
  `scroll.worstFrameMs`, which isn't gated.

## Baseline

Each baseline entry has a `value` plus an optional relative `tolerance` and
absolute `slack`, set only where runs of one build differ:

- Interaction and scroll render counts allow 2 renders. One-second display
  timers, such as live elapsed times, can tick inside a window, which moved
  single counts by one render on GitHub's runner.
- Bundle and payload bytes allow 1% for build hosts and generated IDs.

The gate reports one of three results for a metric outside its band:

- `regressed` fails the check. Fix it, or accept it on purpose with
  `bun run perf:check --update` and explain the baseline change in review.
- `new` means the metric has no baseline yet. It fails the check until
  `--update` records one.
- `improved` passes and asks you to run `--update` to lock the improvement in.

`--update` rewrites only metrics outside their band. Baselines move only with
a reviewed diff, so small increases can't pile up unnoticed.

## Coverage

These scenarios cover chat interactions. They don't cover settings pages or
searching a large workspace (see `PERF-3` in
[the audit](../../docs/audit-issues.md)).

Virtualization mounts only nearby messages. Browser find and screen readers
see only those, and Tab reaches the composer after the last mounted row
without crossing the whole history.
