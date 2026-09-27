# Async agents prototype

Interactive mock for [the async agents proposal](../../../docs/design/async-agents.md). Setup, tests, and screenshots are described in [the experimental mocks README](../README.md).

Visit `http://localhost:5203/dev/experimental/async-agents`. `?scene=started`, `chatting`, `question`, `inflight`, or `finished` opens a scene directly. `&panel=list` or `&panel=detail` opens the Agents panel.

Try:
- the status row's stop and details actions
- the header's agents button
- the Agents panel's list, detail, Messages and Activity tabs, Back, and Escape
- Simulate your answer in the question scene
- Simulate step boundary in the mid-reply scene

The sidebar shows the three badge states.

## Files

- `AsyncAgentsDemo.tsx`: scenes and transcripts, including a result delivered mid-reply.
- `AgentsPanel.tsx`: the Agents view of the artifact sidebar, with its list and detail.
- `async-agents.css`: panel, queued-update, and reply-step styles.
- `async-agents.pw.ts`: card status and stop, chatting during work, question and reply, queued and delivered mid-reply results, idle wakes, panel navigation and focus, stopping from the panel, badge names, mobile layout, and screenshot capture.
