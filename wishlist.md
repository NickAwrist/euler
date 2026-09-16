Really want

- MCPs
- Artifacts (Claude-style preview for HTML, charts, markdown, and SVGs)
- `apply_patch` file editing tool:
  - Structured diff/patch format aligned with model pre-training (e.g. `*** Begin Patch ... *** End Patch` or unified diff envelope)
  - Keep bash as the companion alternative so the model can still use `sed` or `cat` for quick one-line substitutions or script generation

Rebranding

- Rebrand project from "Orbis Agents" to "Euler" (UI title, metadata, documentation, shell labels, and environment constants)

Cleanup

- Delete single-purpose language tools like `run_tsc` (rely on general shell/bash instead of bespoke wrappers)

Low priority / Nice to have

- Tool approval:
  - Must default to always allow (opt-in only to avoid workflow friction).
  - Abstract policy engine decoupled from specific tools, supporting user-defined regex allow lists and block lists (e.g. matching command lines, file patterns, or tool arguments).
