# Tool permissions

**Customization > Tools** has one rule list. Each rule allows, asks about, or
denies a tool call.

## Rules

The tool picker lists the tools of your active features, including connected
MCP servers. To require approval for everything, add an **Ask** rule for **All
tools**, then add **Allow** rules for the exceptions.

A rule matches one of three things:

- **Any arguments**
- A **Field match** on one argument
- The complete arguments of a call, saved by **Allow matching calls**

Field names come from the tool's own schema, including nested paths. Enum and
boolean fields use pickers, numeric fields take numbers, and text fields take
an **Equals** value or a **Regex**.

Regex uses RE2 syntax with no slash delimiters. `^npm\s+publish\b` matches a
command that starts with `npm publish`, and `npm\s+publish` matches it
anywhere. Euler rejects invalid patterns.

When several rules match a call, a **Deny** rule always wins. Otherwise the
most specific rule wins, compared in this order:

1. Scope: a rule for the chat, then one for the workspace, then one for all
   chats
2. Tool: a specific tool, then **All tools**
3. Arguments: complete arguments, then **Equals**, then **Regex**, then **Any
   arguments**
4. Position: the rule lower in the list

A call that matches no rule is allowed. A tool whose feature is off stays
denied whatever the rules say.

Rules apply to MCP tools too. They don't change the MCP server's own access.

Rules live in user preferences, so they survive a backend restart. Deleting a
chat removes the rules scoped to it and keeps the rest.

## Approvals

An approval request appears above the chat input, for main agents and
subagents. The input stays usable.

- **Allow once** resumes that call.
- **Allow matching calls** saves a complete-arguments rule for the chat and
  workspace, then resumes the call. **Undo** removes the rule.
- **Deny** refuses the call.

A pending approval releases its execution slot and survives a browser reload.
Stop, rewind, and deleting the chat cancel it. A backend restart interrupts
pending calls. It doesn't keep the approval or replay the call.

## Limits

Shell argument rules compare command text. Scripts, interpreters, and quoting
can get around that comparison, so treat these rules as guardrails. What
contains a shell command is its [workspace's](workspaces.md) filesystem and
network restrictions.
