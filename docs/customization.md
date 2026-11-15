# Customization

Everything here is per user, under **Customization** in the app.

## Agents and subagents

Every chat runs one agent with the enabled tools. It can hand self-contained
work to subagents. A subagent gets the same system prompt, tools, and skills,
but starts with a fresh context. It can't start its own subagents or change
skills.

Edit the system prompt under **Personalization**.

## Skills

A `SKILL.md` file has a lowercase hyphenated name, a description of when to
use the skill, and Markdown instructions. The agent sees only the name and
description until it loads the skill.

- Type `$skill-name` in a message to invoke a skill yourself.
- **Import** reads a pasted `SKILL.md`, including the `user-invocable` and
  `disable-model-invocation` frontmatter fields.
- Turn off **Users can invoke** to hide a skill from `$skill-name`.
- Turn off **Agents can load automatically** to keep it out of the agent's
  skill list.
- Ask the agent to create, edit, or delete a skill, for example "update my
  storytelling skill to open with dialogue".

## Features

On the **Tools** tab, **Features** turns **Files**, **Sandbox**, **Web
search**, **Image generation**, or **Subagents** off for your agents. Turn one
off to use an MCP server's version, such as its image generation.

A feature the server cannot run stays off and says what it needs, such as a
Brave Search API key or Bubblewrap. The README lists each requirement.

A chat's sidebar has a tab for each running feature with something to show:
**Files**, **Jobs** for Sandbox, and **Agents** for Subagents. With none of
them running, the sidebar is hidden.

Skills and MCP servers have no switch. Agents get them once you add a skill or
enable a server.

Rules for individual tool calls are in [Tool permissions](tool-permissions.md).

## MCP servers

The **Tools** tab also lists remote [MCP](https://modelcontextprotocol.io/)
servers. **Add** reads a pasted `mcpServers` config:

```json
{
  "mcpServers": {
    "example": {
      "url": "https://example.com/mcp"
    }
  }
}
```

Each server needs a `url`. It can also have `headers`, such as an
`Authorization` token, or `oauth` settings.

- The server stores header values, OAuth client secrets, and tokens. The API
  never returns them.
- Euler rejects local servers configured with `command`, because they would
  run outside the shell sandbox.
- Each agent activation connects to the enabled servers over Streamable HTTP.
  It uses HTTP+SSE when a server answers the first request with 404 or 405.
- Tools appear as `mcp__<server>__<tool>`.
- A server that fails to connect is skipped and logged. The tab connects to
  each server to list its tools, or shows why it couldn't.

### OAuth

A server that asks for OAuth shows **Authorize**. **Disconnect** deletes the
saved tokens and revokes them when the authorization server supports it.

| `oauth` setting | Effect |
| --- | --- |
| none, or `true` | Euler finds the authorization server and registers itself as a client. |
| `clientId`, `clientSecret`, `scopes` | Use a client you registered yourself. |
| `clientMetadataUrl` | Identify Euler by an HTTPS Client ID Metadata Document. |
| `grantType: "client_credentials"` | Sign in with the client's ID and secret. No browser needed. |
| `redirectUri` | Use a different redirect address for this server. |

Sign-in ends at `/api/mcp/oauth/callback`. The web app connects when the
sign-in tab closes. The iPhone app signs in on a sheet that closes itself.

Most authorization servers accept only HTTPS and loopback redirect addresses,
so Euler picks the callback address in this order:

1. The address you opened Euler at, when it is HTTPS or a loopback address
   such as `localhost`
2. `EULER_PUBLIC_URL`, when it is HTTPS. See [Deployment](deployment.md#https).
3. `http://127.0.0.1:<EULER_BACKEND_PORT>`

The third is the machine the browser runs on. When that isn't the server:

- On the web, the sign-in ends on a page that fails to load. Copy its address
  and paste it into the field under the server.
- The iPhone app refuses to start the sign-in. It has nowhere to paste.
