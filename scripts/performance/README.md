# Performance check

CI runs `perf:check` against the production build. It drives the real React
bundle against the real Express API and SQLite in a temporary workspace. A fake
Ollama streams replies one token at a time through a loopback control port, so
no model runs and each token is observed before the next arrives.

The fixture seeds 100 chats, two of them 200 messages long with Markdown, code
blocks, and tool steps. The check opens a long chat in a phone-sized Chromium
and compares what it measures with `baseline.json`.

The fixture uses the app's bundled Geist and Geist Mono fonts, including
inline code, and waits for them to load before measuring. System fonts have
different glyph widths across hosts, which changes message heights and the
virtual rows mounted at each scroll step.

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
runners vary by more than the regressions worth catching. Counts are more
repeatable when inputs, typography, and interaction steps are controlled.
Every metric is "lower is better":

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
measure it, and each window starts and ends quiescent: images and fonts loaded,
finite CSS animations finished, and renders and scroll geometry unchanged
across three two-frame samples. This lets image load, intersection, and resize
callbacks finish before the next action. Streaming waits for each token to
render before sending the next, so a slower machine cannot batch tokens into
fewer commits. The scroll count traverses the thread from bottom to top in
200 settled steps. Timing samples keep the original 40-step traversal
without those settling waits.

`bundle.jsGzipBytes` counts only scripts the app loaded during the check.
Shiki ships a lazy chunk per language, and summing all of them would measure
grammars no user downloads.

Each baseline entry has a `value` plus an optional relative `tolerance` and
absolute `slack`, set only where runs of one build differ. Interaction render
counts allow 2 renders: one-second display timers, such as live elapsed times,
can tick inside a window, which moved single counts by one render on GitHub's
runner. Scrolling uses the same 2-render allowance. Bundle and payload bytes
allow 1% for build hosts and generated IDs. The gate reports:

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
scroll step's cumulative render count, row mount counts, mounted rows, row
heights, and scroll geometry to diagnose differences between hosts.

## Running locally

```bash
bunx playwright install chromium
bun run build
bun run perf:check
```

## Rebase measurement, 2026-10-11

Measured main at `3170cde` and the rebased compiler/virtualization branch with
the same expanded fixture, bundled Geist fonts, and production Chromium runner:

| Metric | Main | Optimized |
| --- | ---: | ---: |
| Open-chat DOM nodes | 15,366 | 1,768 |
| Typing renders | 62,154 | 324 |
| File autocomplete renders | 6,879 | 50 |
| File autocomplete requests | 1 | 1 |
| Streaming renders | 38,450 | 550 or 551 |
| Finish-reply renders | 6,294 | 123 |
| Open-chat renders | 11,399 | 723 |
| Full-thread scrolling renders, 200 steps | 303 | 5,981 |
| Loaded JavaScript gzip bytes | 700,481 | 759,707 |

Scrolling mounts messages as they enter the virtual window, so it does more
React work while initial mounting and reply completion do less. Main's new
image-preview behavior increased the earlier optimized baseline's scroll
renders from 5,445 to 5,755 and open-chat renders from 701 to 718 under the
original system-font fixture. Loaded JavaScript rises from 751,699 to 759,707
bytes with the new features and fixes. The baseline accepts those changes and
the new autocomplete metrics.

The original fixture resolved to Noto Sans locally and DejaVu Sans on GitHub's
runner. Assistant rows were 99 px taller in CI, changing the virtual scroll
path. CI measured 5,769 renders against a local baseline of 5,755. Selecting
bundled fonts makes both hosts measure the same typography.

Font pinning alone did not make the original 40-step scroll count constant:
local runs measured 5,728 or 5,786 renders, and CI measured 5,826. The final
geometry matched, but mount traces identified transient extra mounts of rows
92, 93, and 69 in CI. Waiting longer after each jump cannot remove work that
already happened during it. A 60-render allowance proved insufficient.

The count traversal now uses 200 smaller steps, keeping the actual app,
observers, and image previews. Three local count runs and a diagnostic run
at 4× CPU throttling produced 5,981 renders with each newly encountered row
mounted once. The finer traversal also runs more scroll updates and encounters
more previews, so its total is not comparable to the previous 40-step count. Main is remeasured with the same
200-step traversal. The scroll budget returns to 2 renders of timer slack.
This count gate covers small scroll steps; it no longer covers remount work
during large jumps. The 40-step timing pass reports `scroll.worstFrameMs`
without gating it. Per-step artifacts retain row mount counts and geometry
for checking the result in CI.

The stronger settling check also includes work that the earlier windows
missed: finish-reply rises from 120 to 123 and opening from 718 to 723.
These are measurement changes, with no change to app rendering. Mocked image
responses keep preview loading independent of external sites.

These scenarios cover chat interactions, not settings-page performance or
searching a large workspace. The autocomplete endpoint still walks the entire
workspace per query and returns up to 200 files, while suggestions use eight.
A large-workspace measurement would establish whether traversal or payload
size warrants another optimization.
