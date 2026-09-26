# GitHub issue priorities and branch plan

Reviewed September 24, 2026 against `main` at `910e6c94ceb5cd94d690feb7d538f8197e0e993e` in [NickAwrist/euler](https://github.com/NickAwrist/euler).

The review covered all 32 open issues, their comments, and relevant source code. Twelve issues were labeled bugs, and there were no open pull requests. This is a source-based triage, not a browser reproduction pass. Counts and priorities are a snapshot.

Tool-output display, ephemeral-exit protection, chat titles/export, workspace feedback, Usage display, chat layout, drafting during a run, settings save/discard, model selection, skill validation, skill import and invocation flags, the Home composer, regenerate with reply versions, sidebar date groups, Ollama thinking control, and reasoning progress with a readable trace shipped in PRs #46, #45, #47, #48, #49, #50, #51, #52, #53, #54, #55, #56, #57, #58, #59, and #60. The remaining work is grouped below by shared behavior and code ownership.

## Priorities

- **P1:** Broken workflows or lost output/data.
- **P2:** Usability and correctness.
- **P3:** Optional improvements.

## Separate feature branches and scope splits

| Priority | Issues | Recommended boundary |
| --- | --- | --- |
| P3 | Remaining [#37](https://github.com/NickAwrist/euler/issues/37) | Bulk deletion and model-generated titles. Date groups, relative times, hover menus, and preview cleanup have shipped; search was dropped. |
| P3 | [#12](https://github.com/NickAwrist/euler/issues/12) | Standalone math rendering. Include an explicit policy for dollar delimiters versus currency. |
| P3 | [#27](https://github.com/NickAwrist/euler/issues/27) | UUID transfer via QR/link, retaining the existing identity model. The comment rules out making accounts or single-user mode part of this task. |
| P3 | [#40](https://github.com/NickAwrist/euler/issues/40) | Shortcut hints/help and a neutral slash-command icon. Small independent branch. |
| P3 | [#42](https://github.com/NickAwrist/euler/issues/42) | Dedicated theme branch after layout work settles. Review across the whole UI. |
| P3 | Remaining [#30](https://github.com/NickAwrist/euler/issues/30) | Persist an ephemeral chat and its files. Discard confirmation has shipped; saving changes session/workspace lifecycle. |

An issue split across multiple merges should remain open until its agreed scope is complete, or have the remaining work tracked explicitly in follow-up issues.

## Verification expectations

For each implementation branch, follow `AGENTS.md`: run affected tests, type checking, and lint. Run the UI build for UI changes and browser tests for interaction changes. Focus regression coverage on the behavior changed, including reload/navigation, persistence, and failure paths where relevant.
