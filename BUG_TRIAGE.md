# GitHub issue priorities and branch plan

Reviewed September 24, 2026 against `main` at `910e6c94ceb5cd94d690feb7d538f8197e0e993e` in [NickAwrist/euler](https://github.com/NickAwrist/euler).

The review covered all 32 open issues, their comments, and relevant source code. Twelve issues were labeled bugs, and there were no open pull requests. This is a source-based triage, not a browser reproduction pass. Counts and priorities are a snapshot.

Address model defaults, navigation, missing tool outputs, and ephemeral-chat loss. Group work by shared behavior and code ownership.

## Priorities

- **P1:** Broken workflows or lost output/data.
- **P2:** Usability and correctness.
- **P3:** Optional improvements.

Size estimates describe implementation scope, not elapsed time.

## Recommended branch groups

Each row is suitable for one agent working on one branch, within the stated scope.

| Priority | Branch and issues | Deliverable and rationale | Size |
| --- | --- | --- | --- |
| P1 | `fix/model-defaults`: [#20](https://github.com/NickAwrist/euler/issues/20) | Make Settings and new chats agree on the effective model. Cover unavailable saved models, loading catalogs, and no available models. Standalone fix. | Medium |
| P1 | `fix/view-navigation`: [#14](https://github.com/NickAwrist/euler/issues/14), [#15](https://github.com/NickAwrist/euler/issues/15) | Represent views and tabs in navigation, restore Back/reload behavior, and preserve sidebar preferences. Both involve `ui/App.tsx` and navigation state. Preserve unsaved-settings prompts. | Medium to large |
| P1 | `fix/tool-output-display`: [#13](https://github.com/NickAwrist/euler/issues/13), [#31](https://github.com/NickAwrist/euler/issues/31) | Display generated images and search sources directly from tool results. Both currently depend on the model repeating output correctly. Sources must open in a new tab, per the issue comment. Verify persistence across reload and avoid duplicate images. | Large |
| P1 | `fix/ephemeral-exit`: protection portion of [#30](https://github.com/NickAwrist/euler/issues/30) | Confirm before deleting a nonempty ephemeral chat, explain the badge, and cover chat selection, Home, New chat, and browser Back. Ship protection separately from saving an ephemeral chat. | Medium |
| P2 | `fix/chat-titles-export`: [#18](https://github.com/NickAwrist/euler/issues/18), [#19](https://github.com/NickAwrist/euler/issues/19) | Distinguish actual custom titles from sidebar previews, fix rename behavior, and use proper titles, metadata, and event labels in exports. Shared session metadata makes this a sensible pair. | Medium |
| P2 | `fix/workspace-feedback`: [#17](https://github.com/NickAwrist/euler/issues/17), [#29](https://github.com/NickAwrist/euler/issues/29) | Handle stale file references and file errors clearly; improve folder-dialog wording and hidden-folder behavior. Keep folder switching in slash commands, as requested in the comment. Accurate messages about a file's original workspace require actual workspace provenance. | Medium |
| P2 | `fix/usage-display`: [#16](https://github.com/NickAwrist/euler/issues/16), [#41](https://github.com/NickAwrist/euler/issues/41) | Fix duplicate ticks alongside sparse-data presentation, missing-data tiles, model colors and legend, sorting, and consistent numbers. One bounded Usage-page branch. | Medium |
| P2 | `fix/chat-layout`: [#21](https://github.com/NickAwrist/euler/issues/21), layout portions of [#38](https://github.com/NickAwrist/euler/issues/38) | Fix mobile header overlap, add jump-to-latest, handle empty files panels and Escape focus correctly, and update the browser title. Move halted-response actions to response-actions work and the empty-chat hint to #28. | Medium |
| P2 | `fix/settings-save`: [#34](https://github.com/NickAwrist/euler/issues/34) | Visible Save/Discard controls, dirty-tab indicators, mobile tabs, and a discard warning listing changed settings, as requested in the comment. Include the issue's smaller control/copy corrections. Build after navigation lands. | Medium |
| P2 | `feat/model-selection`: [#32](https://github.com/NickAwrist/euler/issues/32), [#35](https://github.com/NickAwrist/euler/issues/35) | Improve picker capabilities and Enter behavior alongside publisher/model-list scanning. This grouping was explicitly requested in the comments. Keep default resolution in #20. | Medium |
| P2 | `fix/draft-during-run`: [#23](https://github.com/NickAwrist/euler/issues/23) | Allow drafting while running, preserve drafts when the run completes, and keep submission disabled. Message queuing is a separate feature. Standalone fix. | Small to medium |
| P2 | `fix/skill-validation`: validation portion of [#36](https://github.com/NickAwrist/euler/issues/36) | Reuse the existing shared skill schema for inline validation and name normalization. Separate the larger import/runtime additions. | Small |

If a grouped branch is delayed, #16's tick deduplication and #15's sidebar preference fix can ship independently without waiting for the larger changes.

## Separate feature branches and scope splits

| Priority | Issues | Recommended boundary |
| --- | --- | --- |
| P2 | [#26](https://github.com/NickAwrist/euler/issues/26) and halted-response actions from #38 | Dedicated response-actions work. The comment supports Regenerate on assistant replies and choosing a different model. Preserving alternatives requires a storage/history design. Prefer staged merges for history preservation and the UI. |
| P2 | Remaining [#36](https://github.com/NickAwrist/euler/issues/36) | Paste/import `SKILL.md` plus `user-invocable` and `disable-model-invocation` support. Those flags need persistence and runtime enforcement, not just editor checkboxes. One dedicated branch after validation. Treat export and a general on/off toggle as optional follow-ups. |
| P2 | [#28](https://github.com/NickAwrist/euler/issues/28) and the empty-chat hint from #38 | Centered initial composer with the requested transition to the normal position. Decide session creation timing and repair remaining empty-session cleanup gaps. Build after navigation and ephemeral-exit protection. |
| P2 | [#37](https://github.com/NickAwrist/euler/issues/37) | Start with sidebar search, date groups, cleaner timestamps, and preview cleanup. Split bulk deletion and model-generated titles into follow-ups. |
| P2 | [#33](https://github.com/NickAwrist/euler/issues/33) | Standalone Ollama thinking-control branch spanning capabilities, selected effort, and provider requests. Coordinate with model-picker changes. |
| P2 | [#25](https://github.com/NickAwrist/euler/issues/25), [#39](https://github.com/NickAwrist/euler/issues/39) | Reasoning progress and readable trace details can share one branch. Start with collapsible content, readable labels, and durations. Treat a full waterfall as a follow-up if it expands the work substantially. |
| P3 | [#12](https://github.com/NickAwrist/euler/issues/12) | Standalone math rendering. Include an explicit policy for dollar delimiters versus currency. |
| P3 | [#27](https://github.com/NickAwrist/euler/issues/27) | UUID transfer via QR/link, retaining the existing identity model. The comment rules out making accounts or single-user mode part of this task. |
| P3 | [#40](https://github.com/NickAwrist/euler/issues/40) | Shortcut hints/help and a neutral slash-command icon. Small independent branch. |
| P3 | [#42](https://github.com/NickAwrist/euler/issues/42) | Dedicated theme branch after layout work settles. Review across the whole UI. |
| P3 | Remaining [#30](https://github.com/NickAwrist/euler/issues/30) | Persist an ephemeral chat and its files. Separate from urgent discard confirmation because it changes session/workspace lifecycle. |

An issue split across multiple merges should remain open until its agreed scope is complete, or have the remaining work tracked explicitly in follow-up issues.

## Agent scheduling and merge order

The initial parallel batch can be model defaults and Usage fixes. These have relatively little overlap.

Give one agent ownership of the navigation sequence:

1. #14 and #15: view navigation and sidebar preferences.
2. #30: ephemeral-exit protection.
3. #34: settings save/discard behavior.
4. #28: home composer and session creation.

These touch the same navigation and exit behavior. Parallel branches would create avoidable conflicts.

Sequence tool-output work before response-version work because both affect messages and history. Keep #32 and #35 together, as requested. Coordinate model-selection work with #20 and #33, and skill import/runtime work with the earlier validation branch.

## Findings to verify before implementation

- **#20 is partly overstated.** New-chat creation already falls back to an available model when the catalog is populated in `ui/hooks/run/useSessionsAndNavigation.ts`. Hardcoded defaults and misleading Settings remain, but reproduce the failing paths first.
- **#28 already has empty-session cleanup on several navigation paths** in the same hook. Find the missing cases before adding another cleanup mechanism.
- **Tool results currently contain text only** in `src/tools/BaseTool.ts`. Images and search sources need reliable extraction or structured metadata that survives the full message lifecycle.
- **Skill invocation flags extend the current data model.** Inspect `src/schemas/skills.ts`, `src/db/skills/types.ts`, and `src/skills/runtime.ts` together when implementing the remainder of #36.

## Verification expectations

For each implementation branch, follow `AGENTS.md`: run affected tests, type checking, and lint. Run the UI build for UI changes and browser tests for interaction changes. Focus regression coverage on the behavior changed, including reload/navigation, persistence, and failure paths where relevant.

No implementation tests or browser reproductions were run for this triage document.
