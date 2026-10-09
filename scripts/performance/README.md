# Performance check

CI runs `perf:check` against the production build. It drives the real React
bundle against the real Express API and SQLite in a temporary workspace. A fake
Ollama streams replies one token at a time through a loopback control port, so
no model runs and every window is deterministic.

The fixture seeds 100 chats, two of them 200 messages long with Markdown, code
blocks, and tool steps. The check opens a long chat in a phone-sized Chromium
and compares what it measures with `baseline.json`.

It gates on **counts, not milliseconds.** Wall-clock timings on shared CI
runners vary by more than the regressions worth catching; counts of work do
not. Every metric is "lower is better":

| Metric | What a regression means |
| --- | --- |
| `idle.domNodes` | The open chat or sidebar mounts more elements |
| `idle.animations` | Something animates while nothing happens |
| `health.rendersPerPoll` | An unchanged Ollama health report re-renders its consumers |
| `scroll.renders` | Scrolling the conversation renders components |
| `typing.renders` | Typing in the composer renders more than the composer |
| `stream.renders` | A streamed token renders more than the live reply (50 tokens) |
| `finishReply.renders` | Completing a reply re-renders the existing history |
| `openChat.renders` | Switching to another long chat renders more components |
| `bundle.jsGzipBytes`, `bundle.cssGzipBytes` | The scripts and styles the app loads grew |
| `api.sessionResponseBytes`, `api.sessionsResponseBytes` | Chat and chat-list payloads grew |

Component renders are counted through the DevTools global hook, which
production React calls on every commit: each component React actually rendered
counts once. Renders, not commits, are what a broken memo or an unstable prop
multiplies. The Ollama health poll is held during every window that does not
measure it, and each window starts and ends quiescent: images loaded and finite
CSS animations finished. Streaming waits for each token to render before
sending the next, so a slower machine cannot batch tokens into fewer commits.

`bundle.jsGzipBytes` counts only scripts the app loaded during the check.
Shiki ships a lazy chunk per language, and summing all of them would measure
grammars no user downloads.

Each baseline entry has a `value` plus an optional relative `tolerance` and
absolute `slack`, set only where runs of one build differ. Interaction render
counts allow 2 renders: one-second display timers, such as live elapsed times,
can tick inside a window, which moved single counts by one render on GitHub's
runner. Bundle and payload bytes allow 1% for build hosts and generated IDs.
The gate reports:

- `regressed` — the PR fails. Fix it, or accept it deliberately with
  `bun run perf:check --update` and explain the baseline change in review.
- `improved` — run `--update` to lock the improvement in. Baselines only move
  with a reviewed diff, so small increases cannot accumulate unnoticed.

`--update` rewrites only metrics outside their band; values within it are noise
and leave the baseline unchanged.

Wall-clock medians under 4× CPU throttling (idle main-thread time, typing and
streaming main-thread time, worst frame, worst typing interaction) go to the CI
job summary for trend reading and are never gated. Raw results are uploaded as
a CI artifact.

## Running locally

```bash
bunx playwright install chromium
bun run build
bun run perf:check
```
