# Workspaces

A chat's shell and file tools work in `/workspace`. That is either a private
sandbox or a folder on the server that you select. File tools also accept
paths relative to `/workspace`.

Three slash commands switch between them:

- `/directory` lets the chat work in a folder on the server. The UI shows its
  host path. [`EULER_HOST_DIRECTORY`](configuration.md#environment) sets where
  the folder picker starts.
- `/sandbox` returns the chat to its private sandbox.
- `/link` joins another chat's sandbox. See [Linking chats](#linking-chats).

[Tool permissions](tool-permissions.md) decide whether a tool call runs. The
workspace decides what the call can reach.

## Sandbox and directory policies

| | Sandbox | Directory |
| --- | --- | --- |
| Network | Isolated, separate per command | The host's |
| Virtual-memory cap | 2 GB | None |
| Extra `bun` and `node` mounts | None | The backend's, read-only |
| `HOME` | `/workspace` | Temporary, discarded after each command |

Both keep system files read-only and hide the host's home and environment.
Credentials inside a selected directory stay readable by the agent. The
temporary home keeps package-manager caches out of that directory.

Directory commands find toolchains from the backend's own runtime executable
first, then its `PATH`:

- Script shims, such as version-manager wrappers, are skipped.
- `bunx` is available when Bun is found.
- Other package managers, such as npm, are available only if installed under
  `/usr` or `/usr/local`.
- When a root backend switches to the directory's owner, discovery skips
  executables that owner can't read and execute. Install runtimes where that
  owner can reach them.

## Networking in directory workspaces

Directory commands can download dependencies and reach services on the backend
machine and its local network. That includes loopback-only services such as
Euler, Ollama, and ComfyUI. Their requests count as local, so a loopback check
can't tell an agent command from a person at the machine.

Background servers share host ports with other chats and applications. Run a
long-lived server as a background job and bind it to `0.0.0.0` to reach it from
another machine.

Sandbox commands can't expose a server to the host browser.

## File access

Workspace file tools need Linux with procfs. They never follow symlinks, so a
link can't lead them outside the workspace.

## Linking chats

Run `/link` in a chat to work in another chat's sandbox. Linking to a chat that
is itself linked joins the same sandbox, so links never chain.

A sandbox is kept while the chat that created it or any chat linked to it
still uses it. After the last one is deleted or switches away, the sandbox
moves to the workspace trash for 7 days.

## Ephemeral chats

An ephemeral chat expires 24 hours after you create it. Set
`EULER_EPHEMERAL_CHAT_TTL_HOURS` to change that. The server checks every minute
and waits while the chat has agents or background jobs in progress. It then
deletes the chat's messages, agents, jobs, and sandbox for good, skipping the
trash.

A sandbox another chat still links to is kept, and goes to the trash once no
chat uses it. Selected local directories are never removed.

## Artifacts

Run `/workspace` to browse the chat's files. The artifact sidebar previews
them, including Markdown, images, and HTML with inline CSS. HTML previews
disable scripts and external resources.

## Bubblewrap on Ubuntu 24.04

Shell tools need Bubblewrap at `/usr/bin/bwrap` or `/bin/bwrap`. Without a
working one, Euler turns the Sandbox feature off.

Ubuntu can block the capabilities Bubblewrap needs, including its isolated
loopback interface. The symptom is
`loopback: Failed RTM_NEWADDR: Operation not permitted`, with AppArmor denials
for `bwrap` and the `unprivileged_userns` profile in `journalctl -k`.

For `/usr/bin/bwrap`, install the included profile:

```bash
sudo install -m 0644 config/apparmor/euler-bwrap /etc/apparmor.d/euler-bwrap
sudo apparmor_parser -r /etc/apparmor.d/euler-bwrap
```

The profile lets Bubblewrap create user namespaces, following
[Ubuntu's guidance](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).
The runner's filesystem restrictions and the workspace's network policy still
apply. Euler checks again on the next turn, so the backend needs no restart.

To confirm the sandbox works, run the
[sandbox tests](development.md#sandbox-tests).
