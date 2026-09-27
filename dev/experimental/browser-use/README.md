# Browser use prototype

Interactive mock for [the browser-use proposal](../../../docs/design/browser-use.md). It is not a browser implementation. It uses fictional content, fixed demo credentials, and local React state. No credentials are collected, no messages are sent, and reset does not change real data. Setup, tests, and screenshots are described in [the experimental mocks README](../README.md).

Visit `http://localhost:5203/dev/experimental/browser-use`. `?scene=agent`, `login`, `finished`, `selection`, or `settings` opens a scene directly.

Try the take-control icon, collapse and expand, Resume agent, End task, Simulate agent requesting login, Simulate agent finishing, Simulate sign in, selecting a deployment row, and reset confirmation. The 700 ms handoff delay demonstrates a pending acknowledgement. It provides no security boundary. Navigation chrome and the message composer are illustrative.

## Files

- `BrowserUseDemo.tsx`: scenario state, transcript, and live browser card.
- `MockWebsite.tsx`: fictional deployment dashboard and read-only login form.
- `browser-use.css`: browser, website, and settings styles.
- `browser-use.pw.ts`: handoff, explicit resume, completion, ending a task, selection, reset dialog, mobile layout, and screenshot capture.
