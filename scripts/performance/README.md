# Performance check

CI runs `perf:check` against the production build. It drives the real React
bundle against the real Express API and SQLite in a temporary workspace. A fake
Ollama streams replies one token at a time through a loopback control port, so
no model runs and every window is deterministic.

The fixture seeds 100 chats, two of them 200 messages long with Markdown, code
blocks, and tool steps. The check opens a long chat in a phone-sized Chromium
and compares what it measures with `baseline.json`.

The long chats also have eight files in their real sandbox workspaces.
Autocomplete types `@src/perf`, waits for those eight suggestions, and counts
renders and requests. The 150 ms debounce should combine that typing burst
into one request. Links to `example.com` receive a local PNG response through
Playwright routing, so scrolling exercises image previews without external
network timing or failures.

Virtualization mounts only nearby messages. Browser find and screen readers
see those mounted messages, and Tab reaches the composer after the last
mounted row rather than traversing the entire history.

It gates on **counts, not milliseconds.** Wall-clock timings on shared CI
runners vary by more than the regressions worth catching; counts of work do
not. Every metric is "lower is better":

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
a CI artifact. The artifact also records resolved text/code fonts and each
scroll step's cumulative render count, mounted rows, row heights, and scroll
geometry to diagnose differences between hosts.

## Running locally

```bash
bunx playwright install chromium
bun run build
bun run perf:check
```

## Rebase measurement, 2026-10-11

Measured main at `3170cde` and the rebased compiler/virtualization branch with
the same expanded fixture and production Chromium runner:

| Metric | Main | Optimized |
| --- | ---: | ---: |
| Open-chat DOM nodes | 15,366 | 1,768 |
| Typing renders | 62,154 | 325 or 326 |
| File autocomplete renders | 6,879 | 50 |
| File autocomplete requests | 1 | 1 |
| Streaming renders | 38,450 | 550 or 551 |
| Finish-reply renders | 6,294 | 120 |
| Open-chat renders | 11,396 | 718 |
| Full-thread scrolling renders | 168 | 5,755 |
| Loaded JavaScript gzip bytes | 700,481 | 759,675 |

Scrolling mounts messages as they enter the virtual window, so it does more
React work while initial mounting and reply completion do less. Compared with
the earlier optimized baseline, scroll renders rise from 5,445 to 5,755 and
open-chat renders from 701 to 718 with main's image-preview behavior. Loaded
JavaScript rises from 751,699 to 759,675 bytes with the new features and fixes.
The baseline accepts those changes and the new autocomplete metrics. Mocked
image responses make these preview counts repeatable.

These scenarios cover chat interactions, not settings-page performance or
searching a large workspace. The autocomplete endpoint still walks the entire
workspace per query and returns up to 200 files, while suggestions use eight.
A large-workspace measurement would establish whether traversal or payload
size warrants another optimization.
