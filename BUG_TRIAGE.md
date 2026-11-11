# GitHub issue priorities and branch plan

Open work in [NickAwrist/euler](https://github.com/NickAwrist/euler/issues),
checked against the source on November 1, 2026, with #27 updated on
November 9 and #37 on November 10. Priorities are a snapshot.

## Priorities

- **P1:** Broken workflows or lost output/data.
- **P2:** Usability and correctness.
- **P3:** Optional improvements.

## Separate feature branches and scope splits

| Priority | Issues | Recommended boundary |
| --- | --- | --- |
| P2 | [#94](https://github.com/NickAwrist/euler/issues/94) | Keyboard scrolling, and likely scrollbar drags, stay pinned to the bottom while a reply streams. The cause is in `use-stick-to-bottom`'s scroll handler. |
| P3 | Remaining [#38](https://github.com/NickAwrist/euler/issues/38) | A Continue or Retry action beside a stopped reply. Stopped replies show no marker; Regenerate is only in the reply menu. |
| P3 | Remaining [#37](https://github.com/NickAwrist/euler/issues/37) | Model-generated titles. |
| P3 | Remaining [#27](https://github.com/NickAwrist/euler/issues/27) | Settings › General › Show QR shows the user ID as a QR code, which the iPhone app scans. Another browser still needs the ID pasted, so a link that carries it remains. The comment rules out making accounts or single-user mode part of this task. |
| P3 | [#40](https://github.com/NickAwrist/euler/issues/40) | Shortcut hints/help and a neutral slash-command icon. Small independent branch. |

An issue split across multiple merges should remain open until its agreed scope is complete, or have the remaining work tracked explicitly in follow-up issues.

## Verification expectations

For each implementation branch, follow `AGENTS.md`: run affected tests, type checking, and lint. Run the UI build for UI changes and browser tests for interaction changes. Focus regression coverage on the behavior changed, including reload/navigation, persistence, and failure paths where relevant.
