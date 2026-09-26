# GitHub issue priorities and branch plan

Reviewed September 24, 2026 against `main` at `910e6c94ceb5cd94d690feb7d538f8197e0e993e` in [NickAwrist/euler](https://github.com/NickAwrist/euler).

The review covered all 32 open issues, their comments, and relevant source code. Twelve issues were labeled bugs, and there were no open pull requests. This is a source-based triage, not a browser reproduction pass. Counts and priorities are a snapshot.

Tool-output display, ephemeral-exit protection, chat titles/export, workspace feedback, Usage display, chat layout, drafting during a run, settings save/discard, model selection, and skill validation shipped in PRs #46, #45, #47, #48, #49, #50, #51, #52, #53, and #54. The remaining work is grouped below by shared behavior and code ownership.

## Priorities

- **P1:** Broken workflows or lost output/data.
- **P2:** Usability and correctness.
- **P3:** Optional improvements.

## Separate feature branches and scope splits

| Priority | Issues | Recommended boundary |
| --- | --- | --- |
| P2 | [#26](https://github.com/NickAwrist/euler/issues/26) and halted-response actions from #38 | Dedicated response-actions work. The comment supports Regenerate on assistant replies and choosing a different model. Preserving alternatives requires a storage/history design. Prefer staged merges for history preservation and the UI. |
| P2 | Remaining [#36](https://github.com/NickAwrist/euler/issues/36) | Paste/import `SKILL.md` plus `user-invocable` and `disable-model-invocation` support. Those flags need persistence and runtime enforcement, not just editor checkboxes. One dedicated branch. Treat export and a general on/off toggle as optional follow-ups. |
| P2 | [#28](https://github.com/NickAwrist/euler/issues/28) and the empty-chat hint from #38 | Centered initial composer with the requested transition to the normal position. Decide session creation timing and repair remaining empty-session cleanup gaps. |
| P2 | [#37](https://github.com/NickAwrist/euler/issues/37) | Start with sidebar search, date groups, cleaner timestamps, and preview cleanup. Split bulk deletion and model-generated titles into follow-ups. |
| P2 | [#33](https://github.com/NickAwrist/euler/issues/33) | Standalone Ollama thinking-control branch spanning capabilities, selected effort, and provider requests. |
| P2 | [#25](https://github.com/NickAwrist/euler/issues/25), [#39](https://github.com/NickAwrist/euler/issues/39) | Reasoning progress and readable trace details can share one branch. Start with collapsible content, readable labels, and durations. Treat a full waterfall as a follow-up if it expands the work substantially. |
| P3 | [#12](https://github.com/NickAwrist/euler/issues/12) | Standalone math rendering. Include an explicit policy for dollar delimiters versus currency. |
| P3 | [#27](https://github.com/NickAwrist/euler/issues/27) | UUID transfer via QR/link, retaining the existing identity model. The comment rules out making accounts or single-user mode part of this task. |
| P3 | [#40](https://github.com/NickAwrist/euler/issues/40) | Shortcut hints/help and a neutral slash-command icon. Small independent branch. |
| P3 | [#42](https://github.com/NickAwrist/euler/issues/42) | Dedicated theme branch after layout work settles. Review across the whole UI. |
| P3 | Remaining [#30](https://github.com/NickAwrist/euler/issues/30) | Persist an ephemeral chat and its files. Discard confirmation has shipped; saving changes session/workspace lifecycle. |

An issue split across multiple merges should remain open until its agreed scope is complete, or have the remaining work tracked explicitly in follow-up issues.

## Findings to verify before implementation

- **#28 already has empty-session cleanup on several navigation paths** in the same hook. Find the missing cases before adding another cleanup mechanism.
- **Skill invocation flags extend the current data model.** Inspect `src/schemas/skills.ts`, `src/db/skills/types.ts`, and `src/skills/runtime.ts` together when implementing the remainder of #36.

## Verification expectations

For each implementation branch, follow `AGENTS.md`: run affected tests, type checking, and lint. Run the UI build for UI changes and browser tests for interaction changes. Focus regression coverage on the behavior changed, including reload/navigation, persistence, and failure paths where relevant.
