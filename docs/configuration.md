# Configuration

## Environment

Bun and Vite load `.env` from the repository root. Git ignores the file.
Restart the server after changing it. These are the variables you are most
likely to change. [.env.example](../.env.example) has the rest, including
storage paths, background-job limits, and iPhone push.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EULER_BACKEND_PORT` | `3000` | API server port |
| `EULER_BACKEND_HOST` | `127.0.0.1` | API server bind address |
| `EULER_FRONTEND_PORT` | `5174` | Vite dev server port |
| `EULER_OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama endpoint |
| `OPENROUTER_API_KEY` | unset | OpenRouter API key |
| `AI_GATEWAY_API_KEY` | unset | Vercel AI Gateway API key |
| `BRAVE_SEARCH_API_KEY` | unset | Brave Search API key |
| `EULER_HOST_DIRECTORY` | your `HOME` | Starting folder for the directory picker. Set it when running under a service account. |
| `EULER_MAX_RUNNING_AGENTS` | `4` | Agent activations one user may run at once |
| `EULER_SERVE_FRONTEND` | `true` | Serve the built UI from the backend |
| `EULER_PUBLIC_URL` | unset | The HTTPS address MCP sign-in returns to when Euler is opened over plain HTTP. See [OAuth](customization.md#oauth). |

Replies and subagents share the `EULER_MAX_RUNNING_AGENTS` limit across all of
a user's chats. Extra work waits in a queue.

An empty value counts as unset.

## Environment overrides

A nonempty environment value for a provider endpoint or API key overrides the
saved setting. **Settings** then disables that field, and the API rejects
changes to it. Remove the variable and restart the server to manage it in
**Settings**.

`.env.example` sets `EULER_OLLAMA_HOST`, so a copied `.env` locks the Ollama
endpoint field until you remove that line.

## Providers

Each provider and service has a tab under **Settings**:

- **Ollama**: the endpoint and **Context window**
- **OpenRouter**: an API key, credits, and publisher/model choices
- **Vercel AI Gateway**: an API key, credits, and publisher/model choices
- **ChatGPT**: sign-in, described below
- **Image Generation**: provider (Auto, OpenRouter, or Vercel AI Gateway) and default model
- **Web Search**: a Brave Search API key

## ChatGPT

Under **Settings > ChatGPT**, select **Sign in with ChatGPT** and authorize use
of your plan. The sign-in ends on a loopback callback page. Copy that page's
full address into **Callback URL** and select **Connect**. Because you paste it
by hand, this works when the browser and the server are on different machines.

- The connection belongs to your Euler user UUID. Other users connect their
  own accounts.
- Credentials stay on the server in owner-only files under
  `<data root>/chatgpt/`. The API never returns them.
- ChatGPT models appear in the model selector once connected.
- **Disconnect** clears the local credentials and tries to revoke the
  renewable session.

Euler uses OpenAI's
[Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and
[Responses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
Access and limits depend on the plan permissions the account grants.
