# Codebase audit issues

Audited October 3, 2026 against `main` at `523104d`. Each issue has a stable ID
(for example `SEC-2`) so work can be assigned by category or by issue. Severity
uses Critical / High / Medium / Low. Effort uses S (under a day), M (a few days),
and L (a week or more).

Issues are listed once, under the category that owns the fix. Related issues are
cross-referenced by ID. Remove an issue from this file when it is resolved.

## Contents

1. [Security](#1-security)
2. [Agent tools and model context](#2-agent-tools-and-model-context)
3. [LLM provider reliability](#3-llm-provider-reliability)
4. [Legacy and dead code](#4-legacy-and-dead-code)
5. [Architecture](#5-architecture)
6. [Type safety and data contracts](#6-type-safety-and-data-contracts)
7. [Frontend engineering](#7-frontend-engineering)
8. [API and backend consistency](#8-api-and-backend-consistency)
9. [Performance](#9-performance)
10. [Observability](#10-observability)
11. [User experience](#11-user-experience)
12. [Testing and CI](#12-testing-and-ci)
13. [Developer experience, configuration, and dependencies](#13-developer-experience-configuration-and-dependencies)

---

## 1. Security

The server has no authentication. A browser-generated UUID in `X-Euler-User-ID`
only separates data; it does not prove identity. Any client that can reach the
API can browse the host filesystem, point a chat's workspace at any directory the
server can access, and have the agent read, write, or run commands there. This is
acceptable only on a trusted network, and nothing currently enforces that.
Address `SEC-1` first: it closes the remote path that works even when the server
listens only on localhost.

### SEC-1. DNS rebinding exposes the full API to any website (High, S)

**Where:** `vite.config.ts` (`server.host: "0.0.0.0"`, `allowedHosts: true`),
`src/app.ts` (no `Host` header check).

**Problem:** Vite accepts any `Host` header and proxies `/api` to the backend.
Express accepts any `Host` header too. A malicious page can rebind its domain
to `127.0.0.1` or the machine's tailnet address. The browser then treats API
calls as same-origin, so CORS does not apply and the custom user header is
allowed. With `SEC-2`, the page can select a home directory as a workspace and
ask the agent to write files there, such as `~/.bashrc`. That is code execution
as the server user.

**Fix:**
- Add Express middleware before all routes that rejects requests whose `Host`
  (without port) is not in an allowlist: `localhost`, `127.0.0.1`, `[::1]`,
  `spaceheater`, `spaceheater.tail95018.ts.net`. Make the list configurable,
  for example `EULER_ALLOWED_HOSTS`, read through `envConfig`.
- Replace Vite's `allowedHosts: true` with the same list.
- Return the standard `FORBIDDEN` error envelope.

**Done when:** A request with `Host: evil.example` gets 403 from both the
backend and the Vite dev server. Normal access through every listed host still
works. An e2e test covers the rejection.

### SEC-2. No authentication on filesystem and settings routes (High, M)

**Where:** `src/userIdentity.ts`, `src/routes/directories.ts`,
`src/routes/sessions.ts` (`select-directory`), `src/routes/settings.ts` (API keys
and OpenRouter publisher routes have no owner check).

**Problem:** Identity comes from the client. `/api/directories` lists any
directory on the host. `select-directory` binds any readable and writable
directory as the agent's workspace. Bubblewrap mounts that directory read-write,
and the file tools can modify it. Global settings, including the OpenRouter and
Brave API keys, can be changed by any client.

**Fix:** Add real authentication suited to the deployment. Tailscale identity
headers are a good fit: when traffic arrives through `tailscale serve`, trust
`Tailscale-User-Login` and reject requests without it unless they come from
loopback. A simpler option is a shared secret in `EULER_ACCESS_TOKEN` sent as a
bearer token. Document the trust model in the README either way.

**Done when:** Unauthenticated requests to every `/api` route except health
checks are rejected, and the README states the trust model.

### SEC-3. Vite dev server is exposed to the whole LAN (Medium, S)

**Where:** `vite.config.ts` (`server.host: "0.0.0.0"`).

**Problem:** `0.0.0.0` listens on every interface, including untrusted Wi-Fi,
not just Tailscale. Everything in `SEC-2` is reachable from the LAN in
development.

**Fix:** Make the dev bind address configurable, for example
`EULER_FRONTEND_HOST`, defaulting to `127.0.0.1`. Set it to the Tailscale IP or
`0.0.0.0` only when needed. `SEC-1` and `SEC-2` reduce the risk either way.

### SEC-4. Local workspace downloads bypass the stated policy (Medium, S)

**Where:** `src/routes/sessions.ts` (`GET /:id/workspace/file` refuses local
workspaces), compared with `src/routes/artifacts.ts`
(`GET .../artifacts/download` serves local workspaces).

**Problem:** Two routes download workspace files with opposite rules for local
directories, so the restriction gives no protection. See also `API-1`.

**Fix:** Decide whether local workspace files may be downloaded. Enforce that
rule in one place, either `downloadWorkspaceFile` or `WorkspaceService`, and
remove the redundant route.

**Done when:** One download route remains, and a test asserts the chosen
behavior for local workspaces.

### SEC-5. The loopback check passes for every proxied request (Low, S)

**Where:** `src/http/isLoopbackRequest.ts`, used by the `reveal` routes.

**Problem:** Behind the Vite proxy or `tailscale serve`, every request comes
from `127.0.0.1`. So "reveal only on the machine running Euler" passes for
remote devices too.

**Fix:** After `SEC-2`, decide based on the authenticated client rather than the
socket address. Alternatively, reject the request when any forwarding header is
present.

### SEC-6. A model-supplied grep regex can block the server (Low, S)

**Where:** `src/tools/grep.ts` (`searchFile`).

**Problem:** The time budget is checked every 500 lines. One catastrophic
backtracking regex on a single long line blocks the event loop, and with it
every request and agent.

**Fix:** Run the search with ripgrep inside the sandbox, or reject patterns with
nested quantifiers and cap line length before matching.

### SEC-7. Favicon DNS validation is separate from the connection (Medium, M)

**Where:** `src/favicons/faviconService.ts` (`isPublicHost` and `fetchPublic`).

**Problem:** The service validates addresses with `dns.lookup`, then calls
`fetch(url)`, which resolves the hostname independently. An attacker-controlled
DNS answer can change between the check and the connection. Redirect validation,
private-address blocking, and body limits are already useful, but they do not
bind the actual connection to a checked address. The check/connect gap is
confirmed statically; a full DNS-rebinding exploit was not attempted.

**Fix:** Use a resolver/connector that connects only to the validated public
address while retaining the original hostname for TLS and the Host header, or
enforce equivalent outbound network restrictions. Keep validation on redirects.

**Done when:** A controlled resolver test changes its answer between validation
and connection and cannot cause a private-network request.

---

## 2. Agent tools and model context

These issues directly affect what the model sees and therefore answer quality,
token cost, and context overflow.

### TOOL-1. Bash output silently loses lines (High, S)

**Where:** `src/utils/gitignoreFilter.ts` (`filterOutputLines`), called from
`src/tools/bash.ts` in `start()`.

**Problem:** After each command, stdout lines whose path-like token matches a
gitignore rule are removed. This was verified: output lines `node_modules`,
`*.log`, and the sentence `The build wrote app.log` are all dropped. As a
result, `cat .gitignore`, `git status`, build logs, and prose output reach the
model incomplete. The filter also reads `.gitignore` files after every command.

**Fix:** Delete `src/utils/gitignoreFilter.ts` and its use in `bash.ts`. Command
output must be exactly what the command produced. Ignore rules still apply to
`list_files`, `grep`, and artifacts.

**Done when:** `cat .gitignore` through the bash tool returns the file unchanged.

### TOOL-2. Tool output reaches model history without a size cap (High, S)

**Where:** `src/tools/bash.ts` (`DEFAULT_MAX_BUFFER` = 2 MB),
`src/tools/read_file.ts` (reads the whole file), `src/tools/grep.ts` (no match
limit; reads binary files as UTF-8), `src/agents/BaseAgent.ts`
(`executeToolCall` puts `result.text` into history).

**Problem:** One tool call can add megabytes to the conversation. That content
is resent on every later model call, which inflates latency and OpenRouter
cost, and can exceed the model's context window.

**Fix:**
- Cap tool result text at one choke point in `BaseAgent.executeToolCall`, for
  example 32 to 64 KB. Keep the head and tail and add a clear truncation note.
- Add `offset` and `limit` (lines) to `read_file`, and say in its description
  how to page.
- Cap `grep` at a maximum number of matches and skip binary files (NUL byte in
  the first few KB).
- Keep the full output available to the UI where useful, for example the job
  output for background bash. The model only needs the capped text.

**Done when:** Tests show each tool's model-visible text is capped and includes
the truncation note.

### TOOL-3. Tool arguments are validated two different ways (Medium, M)

**Where:** `parseToolArgs` with Zod in `bash.ts`, `spawn_agent.ts`,
`send_message.ts`, `ask_parent.ts`, `cancel_agent.ts`, and `jobs.ts`, compared
with hand-written `typeof` checks in `read_file.ts`, `grep.ts`,
`list_files.ts`, `web_search.ts`, `fetch_web_page.ts`, `generate_image.ts`,
`create_file.ts`, and `delete_file.ts`. Each tool also hand-writes its JSON
schema in `toTool()`.

**Problem:** There are two validation styles, and the JSON schemas can drift
from the actual checks. `read_file` silently accepts an undocumented `filename`
alias.

**Fix:** Give each tool a Zod schema. Generate `toTool()` parameters with
`z.toJSONSchema(schema)` and validate with `parseToolArgs`. Remove the
`filename` alias.

### TOOL-4. Every activation re-encodes all history images (Medium, S)

**Where:** `src/agents/runtime/activation.ts` (`historyWithImages`).

**Problem:** Each activation loads every image attachment in the history from
SQLite and base64-encodes it, then sends them all to the provider again.
Image-heavy chats pay this on every turn.

**Fix:** Send image data only for the most recent N user messages, and replace
older images with a text placeholder. Or cache the encoded data by attachment ID
for the life of the activation.

**Implementation note:** Dropping older images changes what the model can
answer about prior attachments. Prefer caching or lazy encoding where useful;
choose image-pruning behavior explicitly rather than treating it as a transparent
performance fix.

---

## 3. LLM provider reliability

### LLM-1. Stop cannot interrupt a request still waiting for a response (High, S)

**Where:** `src/agents/BaseAgent.ts` (`run` awaits `streamModelChat` before
adding the abort listener), `src/llm/openRouterProvider.ts`
(`streamOpenRouterChat` makes its own `AbortController` that is reachable only
after headers arrive), `src/llm/ollamaProvider.ts`, and
`src/agents/runtime/AgentRuntime.ts` (`cancel` awaits `active.promise`).

**Problem:** Until the provider sends its first byte, which can take a long time
while Ollama loads a model, Stop does nothing. The `POST /stop` request also
stays open until then.

**Fix:** Add `signal: AbortSignal` to `LlmChatRequest`. Pass it to `fetch` in
the OpenRouter provider. For Ollama, call the client's `abort()` when the
signal fires.

**Done when:** A mock OpenRouter scenario that delays headers shows `/stop`
returning promptly and the activation ending as `aborted`.

**Implementation note:** The installed Ollama SDK registers a streamed request
only after headers arrive, and the shared client's `abort()` cancels all
registered streams. Calling it alone does not fix pre-header cancellation and
can stop other chats. Carry a request-specific signal through the SDK fetch
boundary or another isolated adapter, and test cancellation with two concurrent
chats.

### LLM-2. Model streams have no timeouts (High, S)

**Where:** the same provider files as `LLM-1`.

**Problem:** A stalled connection or a provider that stops sending chunks leaves
the activation running indefinitely, holding one of the owner's
`EULER_MAX_RUNNING_AGENTS` slots.

**Fix:** Add an idle timeout per chunk, for example 120 seconds without bytes,
and a longer timeout for the first byte to allow model loading. Make both
configurable through `envConfig`. On timeout, fail the activation with a clear
message.

### LLM-3. No retry for transient OpenRouter failures (Medium, S)

**Where:** `src/llm/openRouterProvider.ts`.

**Problem:** A 429, 502, or 503 before streaming starts fails the turn
immediately. The input is then held and the user must deliver it again.

**Fix:** Retry the initial request up to two times with backoff on 429/5xx,
honoring `Retry-After`, only before any chunk has been received. Do not retry
mid-stream.

### LLM-4. Image generation ignores Stop (Medium, S)

**Where:** `src/tools/generate_image.ts`, `src/comfyui/client.ts`
(`waitForPrompt` has a 5-minute timeout and no signal).

**Problem:** Stopping a turn during image generation waits up to 5 minutes, and
the queued ComfyUI prompt keeps running.

**Fix:** Pass `ctx.signal` through `runSerialized` and `waitForPrompt`. On
abort, stop waiting and call ComfyUI's interrupt or queue-delete endpoint.

**Implementation note:** Do not submit an image operation that was cancelled
while waiting in the serialized queue. A global ComfyUI interrupt can affect
another chat's active prompt; remote cancellation must be associated safely with
the intended prompt. `LLM-7` covers the remaining socket and HTTP deadlines.

### LLM-5. No graceful shutdown (Low, S)

**Where:** `src/server.ts`.

**Problem:** On SIGTERM during a deploy, the process exits mid-stream. Restart
recovery handles this, but every deploy marks running turns as "interrupted by
server restart".

**Fix:** On SIGTERM, stop accepting requests, abort active activations with a
"server restarting" reason, wait briefly (under deployctl's 30-second
`stop_timeout`), then close the database.

### LLM-6. A truncated OpenRouter stream is treated as complete (High, S)

**Where:** `src/llm/openRouterProvider.ts` (`openRouterChunks`, `handleBlock`).

**Problem:** `[DONE]` is discarded, finish reasons are not modeled, and EOF
unconditionally yields `done: true`. A synthetic response containing one partial
content delta and no terminal event reproduced successful completion. Partial
answers can be saved as successful, and incomplete tool-call arguments can reach
the permissive argument parser.

**Fix:** Track valid terminal protocol state and reject unexpected EOF. Preserve
partial content as interrupted rather than successful. Validate streamed payloads
as described in `TYPE-5`, and do not execute incomplete tool-call fragments.

**Done when:** Tests distinguish normal completion, partial text followed by EOF,
and incomplete tool arguments followed by EOF. Truncated responses surface a
recoverable failure.

### LLM-7. Image generation deadlines do not cover the full operation (High, M)

**Where:** `src/comfyui/client.ts` (`connectWebSocket`, `queuePrompt`,
`waitForPrompt`, `getHistory`, `fetchViewAsset`), `src/tools/generate_image.ts`.

**Problem:** Beyond the Stop issue in `LLM-4`, socket connection, prompt
submission, history retrieval, and asset fetching lack complete application
boundaries for timeout/cancellation. `waitForPrompt` clears its five-minute timer
before awaiting history, so a stalled history request escapes that timeout.
Disconnect does not immediately reject pending prompt waiters. The completion
waiter is registered after submission, which also leaves a timing window for an
early completion event; confirm that race with a fake socket test.

**Fix:** Apply signal/deadline handling to every stage. Reject pending waiters on
socket close or disconnect. Register completion tracking before an event can be
lost, or recover completion from provider history. Make serialized admission
abort-aware so cancelled queued work never submits a prompt. Cancel remote work
only when it can be safely associated with that prompt.

**Done when:** Tests cover a socket that never opens, a dropped socket, immediate
completion, stalled history retrieval, and cancellation while queued. Each case
settles and releases the serialized queue without interrupting another chat.

### LLM-8. Workspace initialization has an unobserved rejection (Medium, S)

**Where:** `src/app.ts` (`void workspaceService.initialize()`).

**Problem:** Initialization starts an asynchronous cleanup operation without
awaiting it or handling its rejection. Filesystem failures in this initial pass
can become unhandled rejections, even though later timer-driven cleanup catches
and logs failures.

**Fix:** Define whether initial cleanup failure prevents readiness or allows
startup with a logged failure and scheduled retry. Await initialization in the
startup lifecycle or explicitly observe its rejection.

**Done when:** An injected initialization failure has a logged, deterministic
startup outcome and does not escape as an unhandled rejection.

---

## 4. Legacy and dead code

This app has one deployment, and data migrations are one-shot (see the project
memory note). This code runs on every startup or request but no longer serves a
current requirement. Before deleting a migration, confirm the production
database has already run it, for example by checking that the old column or
table no longer exists.

### LEG-1. Column-adding migrations run on every startup (Medium, S)

**Where:** `src/db/migrations.ts`: `migrateSessionsDirectoryColumn`,
`migrateSessionsWorkspaceKindColumn`, `migrateSessionsOwnerColumn`,
`migrateMessagesAttachmentsColumn`, `migrateSkillInvocationColumns`,
`migrateMessagesVersionsColumn`, the `activation_id` and
`last_activity_at`/`last_viewed_at` additions in `runMigrations`,
`migrateRemoveAgents`, the `searxng_host` delete, the
`openrouter_models_seeded_v*` deletes, and the `legacy_model_favorites` rename
inside `migrateOpenRouterCatalog`.

**Fix:** Put the current columns directly in the `CREATE TABLE` statements in
`src/db/connection.ts`. Keep only `CREATE TABLE/INDEX IF NOT EXISTS` and the
publisher seeding. Delete the migration functions.

### LEG-2. One-shot data migrations are still present (Medium, S)

**Where:**
- `src/db/agentTables.ts`: `moveHistory` (its own comment says to delete it
  once it has run)
- `src/db/attachmentMetadataMigration.ts`
- `src/db/jobErrorMigration.ts` (landed October 2; confirm it has been deployed)
- `src/db/users.ts`: legacy owner claim (`LEGACY_USER_DATA_CLAIMED_BY_KEY`) and
  the `legacy_model_favorites` copy
- Tests: `tests/db/agentHistory.test.ts` (only the migration part, if any),
  `tests/db/attachmentMetadata.test.ts`, `tests/db/jobErrorMigration.test.ts`,
  `tests/db/userOwnershipMigration.test.ts`

**Fix:** Delete the code, the tests, and the unused constants in
`src/db/constants.ts`. `ensureUserData` then only seeds default skills, so see
`API-3`.

### LEG-3. Browser preference migration and its schema (Low, S)

**Where:** `ui/persist/userPreferences.ts` (the localStorage branch of
`initializeUserPreferences`), `src/schemas/legacyUserPreferences.ts`,
`tests/ui/legacyUserPreferences.test.ts`.

**Problem:** Each browser migrates its own localStorage. Once every browser you
use has loaded the app since PR #67, this branch is dead.

**Fix:** After confirming, treat a `null` response from `GET /api/settings/user`
as "use defaults" and delete the legacy schema, branch, and test.

### LEG-4. Global ComfyUI image defaults seed user preferences (Low, S)

**Where:** `src/db/userPreferences.ts` (`defaultUserPreferences`),
`src/db/settings.ts` (`getComfyUIDefaultModel`, `getComfyUIImageSize`,
`getComfyUINegativePrompt`), and the `COMFYUI_DEFAULT_*` keys in
`src/db/constants.ts`.

**Fix:** Defaults come from `userPreferencesSchema.parse({})`. Delete the global
keys and getters, and delete the rows from `app_settings` once.

### LEG-5. Compatibility branch for raw OpenRouter model routes (Low, S)

**Where:** `src/llm/modelSelection.ts` ("Accept the raw route for compatibility
with early OpenRouter builds").

**Problem:** It runs a DB lookup on every model resolution, which happens on
every message, every usage record, and every model call.

**Fix:** Delete the branch. Run a one-shot update for any `sessions.model` or
agent `model` values stored without the `openrouter:` prefix.

### LEG-6. Docker networking hints after Docker was removed (Low, S)

**Where:** `src/containerNetworkHint.ts`, used in `src/routes/ollama.ts` and
`src/routes/comfyui.ts`. Docker deployment was removed in `2fe581b`.

**Fix:** Delete the module and its two call sites.

### LEG-7. Unprefixed environment variable aliases (Low, S)

**Where:** `src/env.ts` and `vite.config.ts`: `BACKEND_PORT`, `BACKEND_HOST`,
`FRONTEND_PORT`, `OLLAMA_HOST`, `COMFYUI_HOST`, `EULER_JINA_API_KEY`,
`EULER_OPENROUTER_API_KEY`, `EULER_BRAVE_SEARCH_API_KEY`.

**Problem:** Two names per setting, and `OLLAMA_HOST` is harmful: Ollama's own
server reads it as its bind address, often `0.0.0.0`, which is not a valid
client URL.

**Fix:** Keep one documented name per setting, using the `EULER_` prefix except
for the provider API keys that `.env.example` already documents.

### LEG-8. The UI hand-coerces sessions that fail validation (Medium, S)

**Where:** `ui/persist/sessions.ts` (`fetchSessionData`, the branch after
`StoredRunSessionSchema.safeParse` fails).

**Problem:** It casts unvalidated data into `StoredRunSession`, which undoes the
schema check and hides contract drift.

**Fix:** Delete the fallback. A parse failure should become the session error
state with a clear message.

### LEG-9. Dead parameters and helpers (Low, S)

**Where:**
- `src/agents/BaseAgent.ts`: the `prompt` and `images` parameters of `run`
  (only ever called as `run("", ctx)`), the `userMessage`/`userImages` path, and
  the unused `name`/`description` fields if nothing reads them after
  `RunContext.agentName` (check before removing)
- `src/agents/agentManager.ts`: `getToolInstance`
- `src/http/asyncRoute.ts`: Express 5 already forwards rejected promises (see
  `CONS-3`)
- The `/api/runs` 404 assertion in `tests/e2e/asyncAgents.test.ts`, which tests
  a route removed long ago

### LEG-10. Stale root documents (Low, S)

**Where:** `BUG_TRIAGE.md` (snapshot dated September 24), `wishlist.md`.

**Fix:** Move open items to GitHub issues and delete `BUG_TRIAGE.md`. Keep
`wishlist.md` only if it is maintained, or move it to `docs/`.

### LEG-11. Unused imports remain in hooks and tests (Low, S)

**Where:** `ModelReasoning` in `ui/hooks/run/useOllamaConnection.ts`,
`MessageStep` in `ui/hooks/run/useRunStreaming.ts`, `BaseAgent` in
`tests/agents/agentManager.test.ts`, `basename` in
`tests/e2e/workspaces.test.ts`, and `modalSurface` in `tests/ui/modal.test.ts`.

**Problem:** These were identified by running TypeScript with
`--noUnusedLocals --noUnusedParameters`. The same check reports the intentionally
unused `args` parameter in the base tool method.

**Fix:** Delete the unused imports and rename the base parameter `_args`.
Enable unused-symbol checks to prevent recurrence. No new behavior tests are
needed for import removal.

---

## 5. Architecture

### ARCH-2. `useRunApp` is a god hook (Medium, L)

**Where:** `ui/hooks/useRunApp.ts` (returns about 95 fields), `ui/App.tsx`
(`ChatView` takes `app: ReturnType<typeof useRunApp>`),
`ui/hooks/run/useSessionsAndNavigation.ts` (13 arguments, including six state
setters and two refs), `ui/hooks/run/useRunStreaming.ts`.

**Problem:** Session, navigation, runtime events, composer, model catalog,
provider health, modals, and settings are combined in one object. Hooks change
each other's state through passed setters and refs, so ownership is unclear and
any change touches `App.tsx`.

**Fix:** Split by owner:
- a session store (active ID, list, navigation, rename and delete)
- a runtime store (event subscription, snapshot, streaming state; see `FE-1`)
- a model catalog hook (models, provider readiness; see `CONS-5`)
- composer state local to `RunInputDock`

Pass narrow props or use context.

### ARCH-3. Fragile route mounting order (Low, S)

**Where:** `src/app.ts` mounts `debugPromptRoutes` at `/api/sessions` before
`sessionRoutes`, whose `router.use("/:id")` middleware would otherwise treat
`debug-prompt` as a session ID.

**Fix:** Mount the debug prompt at `/api/debug-prompt` and update
`ui/hooks/run/useRunDebug.ts`.

### ARCH-4. Session navigation and runtime snapshots both own history (Medium, M)

**Where:** `ui/hooks/run/useSessionsAndNavigation.ts` (`loadSession`),
`ui/hooks/run/useAgentEvents.ts` (`refresh`, `publish`),
`src/routes/sessions.ts` (`GET /:id`), `AgentRuntime.snapshot`.

**Problem:** Loading a chat starts both a stored-session request and a runtime
snapshot request, and both contain transcript history and update message state.
Navigation uses a generation counter and an object-identity check to avoid
replacing newer runtime history. These protections are useful but make ownership
harder to follow and transfer the same history twice. The stored-session response
also includes model history that ordinary chat rendering does not need.

**Fix:** Give transcript state one runtime snapshot/event owner. Let navigation
load session metadata separately, and fetch model history only for consumers
that need it. Preserve stale-navigation and event-replay protections.

**Done when:** Opening a chat loads its transcript once, and tests show that
late navigation responses cannot overwrite newer streamed history.

---

## 6. Type safety and data contracts

### TYPE-1. The step/trace contract is untyped and defined three times (High, M)

**Where:** `src/RunContext.ts` (`Step`, `LlmMetrics`, hand-written
`wireStep()`), `src/schemas/run.ts` (`WireStepSchema = z.record(z.string(),
z.unknown())`), `ui/types/run.ts` (`MessageStep` with `kind: string` and
`status?: string`, and a copied `metrics` type),
`ui/components/Agents/AgentTraceModal.tsx` (`as unknown as MessageStep[]`),
`ui/hooks/run/useAgentEvents.ts` (type guard on `kind`).

**Problem:** The data structure the trace UI depends on has no shared contract,
so changes on the server reach the UI unchecked.

**Fix:** Define `LlmMetricsSchema` and `StepSchema` in `src/schemas/run.ts`:
`kind` and `status` as enums, plus `toolName`, `jobId`, `args`, `result`,
`thinking`, `error`, `startedAt`, `endedAt`, and `agentName`. Derive the server
`Step`, the wire type, and the UI `MessageStep` from it. Replace `wireStep()`
with a parse or a typed pick. Remove the casts.

### TYPE-2. Message `role` is a free string (Medium, S)

**Where:** `src/schemas/run.ts` (`WireMessageSchema.role: z.string()`),
`src/db/types.ts` (`WireMessage.role: string`), the `messages.role` column,
`ui/types/run.ts` (`"user" | "assistant" | "event"`), and the cast in
`ui/hooks/run/useAgentEvents.ts` (`as Message[]`).

**Fix:** Use `z.enum(["user", "assistant", "event"])`, derive the UI `Message`
from the schema, add a `CHECK` constraint on the column, and remove the cast.

### TYPE-3. API helpers return unvalidated casts (Medium, M)

**Where:** `ui/lib/api.ts` (`userApiJson<T>` returns `response.json() as
Promise<T>`, and `null as T`). Callers that trust the shape include
`selectSessionDirectory` and `fetchWorkspaceFiles` in `ui/persist/sessions.ts`.

**Fix:** Make the JSON helpers take a Zod schema
(`userApiJson(url, Schema, options)`) and return `z.infer` of it. Use a separate
overload or helper for `notFound: "null"` that returns `T | null`. Migrate all
callers. AGENTS.md already says type annotations do not validate data.

### TYPE-4. Ollama SDK private fields read through double casts (Low, S)

**Where:** `src/ollamaClient.ts` (two places), `src/routes/ollama.ts`
(`as unknown as { config: { host: string } }`).

**Fix:** Normalize the host URL in project code (default
`http://127.0.0.1:11434`, add the scheme if missing) instead of reading the
SDK's private `config`.

### TYPE-5. Provider JSON is trusted without validating its shape (Medium, M)

**Where:** `src/llm/openRouterProvider.ts` (`JSON.parse(data) as
OpenRouterChunk`), `src/comfyui/client.ts` (`queuePrompt`, `getHistory`,
WebSocket message parsing, and `getModels`).

**Problem:** Parsing valid JSON does not establish the expected object shape.
Provider changes or malformed responses can cause failures later, after useful
boundary context is lost. A syntactically valid OpenRouter `null` chunk, for
example, is asserted to be an object. The Brave client already demonstrates
runtime schema validation for external responses.

**Fix:** Define focused Zod schemas for the provider fields actually consumed.
Allow unused provider fields where appropriate, but reject malformed required
fields at the boundary with safe provider/operation context. Coordinate with
`LLM-6` and `LLM-7`.

**Done when:** Valid JSON with an invalid shape produces a clear dependency
failure rather than a later property-access error or silent empty result.

---

## 7. Frontend engineering

### FE-1. Every streamed token re-renders the app root (Medium, M; profile first)

**Where:** `ui/hooks/run/useAgentEvents.ts` (`setState` and `setPhases` on every
`delta` event, including subagent tokens), `ui/hooks/useRunApp.ts`,
`ui/App.tsx`, `ui/components/MarkdownMessage.tsx` (the streaming message is
parsed three times per render: `normalizeMathDelimiters`,
`extractComfyUIImageUrls`, and react-markdown).

**Problem:** Long replies do quadratic work, and the app root re-renders
continuously while streaming.

**Fix:** First profile a long streamed reply with React DevTools. If it
confirms the problem, move streaming text into a small external store read with
`useSyncExternalStore` by the streaming bubble only, and batch updates per
animation frame. Skip phase updates for events that do not change a phase.
Memoize the markdown preprocessing per content string.

**Investigation note:** `nextAgentPhases` already returns the same object when
the phase has not changed, and `useAgentEvents.publish` skips state updates when
an unrelated/subagent event only advances the sequence. Main-agent streaming
still updates root-owned state. Profile that remaining path rather than adding
phase deduplication that already exists.

### FE-2. UI failures are swallowed (Medium, S)

**Where:** 19 `.catch(console.error)` calls, including Stop
(`ui/hooks/run/useRunStreaming.ts`, `stopGeneration`), the artifact layout
preference save (`ui/App.tsx`), and "viewed" and refresh calls in
`useAgentEvents.ts`. Also `refreshSessions` in
`ui/hooks/run/useSessionsAndNavigation.ts`, which clears the session list on any
error.

**Fix:** Show user-initiated failures (Stop, saves) with `ErrorNotice`,
including the request ID. Keep the last good session list when a refresh fails.
Background refreshes may stay console-only.

### FE-3. Raw buttons instead of shared primitives (Low, M)

**Where:** 66 raw `<button>` elements in 39 files, compared with `IconButton`
used in 10. Example: the debug button in `ui/App.tsx`.

**Fix:** When touching a file, migrate icon-only buttons to `IconButton` and
text buttons to `Button`, as AGENTS.md requires. No dedicated sweep is needed.

### FE-4. A preference write on every file selection (Low, S)

**Where:** `ui/App.tsx` (the effect that calls `updateUserPreferences` with
`layout.artifactState`).

**Fix:** Resolved by `UX-2` (device-local layout). Otherwise, debounce the
write.

### FE-5. The exhaustive-dependencies lint rule is disabled (Low, M)

**Where:** `biome.json` (`useExhaustiveDependencies: "off"`).

**Problem:** Effects avoid stale closures through ref mirrors
(`current.current = …`, `refreshRef.current = refresh`) with no lint backstop.

**Fix:** Enable the rule as a warning, then fix or annotate each finding.

---

## 8. API and backend consistency

### API-1. Duplicate workspace file routes (Medium, S)

**Where:** `GET /api/sessions/:id/workspace/files` and `/workspace/file`,
compared with `/workspace/artifacts/{tree,preview,download}`. The UI still uses both, through
`ui/persist/sessions.ts` (`fetchWorkspaceFiles`, `downloadWorkspaceFile`) and
`ui/components/Artifacts/api.ts`.

**Fix:** Use the artifacts routes as the single file API. Move
`WorkspaceModal`'s file listing and download to them, then delete the older
routes. Coordinate with `SEC-4`.

### API-2. The session list query is N+1 (Low, S)

**Where:** `src/db/sessions.ts` (`listSessionSummaries` runs one query per
session for the first user message).

**Fix:** Use one query with a correlated subquery for the first user message
per session.

### API-3. Every request runs a user-setup transaction, often twice (Low, S)

**Where:** `src/userIdentity.ts` (`requireUserId` calls `ensureUserData` every
time), `src/routes/agentActions.ts` (called in middleware and again in each
handler).

**Fix:** After `LEG-2`, `ensureUserData` only seeds skills. Cache seeded owners
in memory and skip the transaction for them. In `agentActions`, have the
middleware store the owner on `res.locals` and read it in handlers.

### API-4. Title patch logic is convoluted (Low, S)

**Where:** `src/routes/sessions.ts` (`PATCH /:id`, the nested ternary on
`customTitle`).

**Fix:** `patch.title = body.customTitle?.trim() || null` when the key is
present. The schema already trims and validates the type.

### API-5. Workspace changes race with activation admission (High, M)

**Where:** `src/routes/sessions.ts` (`POST /:id/workspace/use-sandbox`).

**Problem:** `use-sandbox` checks busy, awaits provisioning, then changes the
workspace without another busy check. A message can begin activation during that
await, leaving the active tools on their previously resolved directory while
the stored workspace and UI change. The asynchronous gaps are confirmed
statically; concurrent execution was not reproduced during the audit.

**Fix:** Put workspace transitions under a runtime-owned changing-session guard
respected by message/job admission, deletion, and competing workspace changes.
At minimum, perform the final busy check immediately before synchronous mutation.
Preserve local workspace containment.

**Done when:** Barrier-controlled tests race workspace selection/use-sandbox
against message admission and competing changes. No activation can run in a
workspace different from the committed selection.

---

## 9. Performance

Most items need measurement first. `TOOL-2` and `TOOL-4` are the confirmed wins.

### PERF-1. Agent histories are loaded and parsed on every request (Medium, M; measure first)

**Where:** `src/agents/runtime/AgentRuntime.ts` (`main()` calls
`store.list()`, and `pump()` lists session agents then releases every cached
session), `src/db/agents.ts` (`get()` runs `RecordSchema.parse` on full
history).

**Problem:** Each agent-action request, and each scheduler pass, reads and
validates every agent's full history in the chat, then drops the cache.

**Measure:** Time `POST /messages` and `GET /runtime` on a chat with about 200
messages and large tool outputs.

**Fix if confirmed:** Load the main agent's record without its history for
routes that do not need it, using `view()`-style reads. Keep records cached
while a chat has activity, instead of releasing them at the end of every pump.

### PERF-2. The main bundle is 1.1 MB (Medium, S)

**Where:** `ui/main.tsx` and `ui/App.tsx`. Settings, Usage, Customization,
Onboarding, and KaTeX are all eagerly imported. Only the `/dev` demos use
`lazy()`.

**Fix:** Lazy-load `SettingsPage`, `UsagePage`, `CustomizationPage`, and
`Onboarding`. Check the result with `vite build`.

### PERF-3. Listing workspace files walks the whole tree (Low, S; measure first)

**Where:** `src/workspaces/WorkspaceService.ts` (`listFiles` and `walkFiles` stat
every file through per-component file handles), then routes return
`slice(0, 200)`.

**Measure:** The latency of `/workspace/files` with a local workspace on a large
repository.

**Fix if confirmed:** Stop after a bounded number of entries, or remove the
route as part of `API-1`.

### PERF-4. Not worth pursuing now

`EventHub` cloning and serializing each event, unbounded `EventHub.users` and
`JobManager.records` maps at a single user, and the fixed 1-second SSE
reconnect. Revisit only if memory or CPU measurements point here.

### PERF-5. Whole-chat snapshots remain cached in the browser (Medium, S; measure first)

**Where:** `ui/hooks/run/useAgentEvents.ts` (`views` and `recent`).

**Problem:** `views` retains full runtime snapshots for visited chats until a
resync or hook unmount. Recent events are limited by count, not bytes; step events
can contain large traces. A long-lived tab can therefore retain multiple large
histories even when they are no longer visible. This is a confirmed retention
path, not a measured memory leak. Server job and event caches mentioned in
`PERF-4` also need lifecycle bounds if measurements show material growth.

**Measure:** Heap growth while visiting many long chats and inspecting large
job outputs, plus server RSS after many completed jobs and inactive owners.

**Fix if confirmed:** Bound snapshots by entries/bytes and invalidate deleted
chats. Release completed persisted job records when no active caller needs them,
and expire inactive EventHub owners. Preserve replay behavior.
The artifact preview cache and agent-store release logic provide existing
patterns to reuse where appropriate.

---

## 10. Observability

### OBS-1. Error messages are dropped from logs (Medium, S)

**Where:** `src/observability/logger.ts` (`serializeError` keeps a message only
for known error codes or a few system codes).

**Problem:** Provider errors, `TypeError`s, and SQLite constraint failures log
only a name and stack frames, so the cause of a failure is often missing.

**Fix:** Keep `error.message`, truncated to about 500 characters. Redact only
specific sensitive patterns, such as bearer tokens and API keys. Keep the
fixed public messages for API responses; that separation already exists in
`sendError`.

### OBS-2. No log line per LLM call (Medium, S)

**Where:** `src/agents/BaseAgent.ts` (`run`).

**Problem:** Usage rows record tokens and cost but not latency or failures for
the slowest and most failure-prone dependency.

**Fix:** Emit `llm.finished` per model call with provider, model, time to first
token, total duration, outcome (success, aborted, error, timeout), HTTP status
when known, and token counts. Pair this with `LLM-1` and `LLM-2`.

### OBS-3. Logs cannot link a request to the activation it starts (Low, S)

**Where:** `src/agents/runtime/AgentRuntime.ts` (`pump` uses
`withBackgroundLogContext`, which intentionally drops `requestId`).

**Fix:** Log the inbox `messageId` with the `POST /messages` request completion,
and log the delivered message IDs in `activation.started`.

### OBS-4. `LOG_LEVEL=debug` does nothing (Low, S)

**Where:** `.env.example` sets `LOG_LEVEL=debug`. `src/observability/logger.ts`
supports only `info`, `warn`, `error`, and `silent`, and treats unknown values
as `info`.

**Fix:** Add a `debug` level, or change the example to `info` and list the
valid values.

### OBS-5. Failed tools can be logged as successful (Medium, S)

**Where:** `src/tools/BaseTool.ts` (`textToolResult`),
`src/tools/web_search.ts`, `src/tools/fetch_web_page.ts`,
`src/tools/generate_image.ts`, and `src/agents/BaseAgent.ts`
(`executeToolCall`).

**Problem:** Several tools catch errors and return text beginning with "Error"
without setting `failed: true`. The central logger classifies failure only when
an exception was caught there or the result has that flag. Provider failures can
therefore produce `tool.finished` events with `outcome: success`. The `observe`
helper also logs failed stages without the exception, relying on an outer
boundary to retain it.

**Fix:** Standardize structured failure results or let the central boundary
catch exceptions. Preserve safe dependency/status/stage context and log the
cause once at the owning boundary. Do not infer failure from a text prefix.

**Done when:** Failed search, page-fetch, and image calls produce failure logs
with useful diagnostics and no credentials or prompt payloads.

---

## 11. User experience

These come from code review and browser-test names. The app was not used
hands-on during the audit, so confirm each one in the UI before changing it.

### UX-1. Stop feels unresponsive while a model loads (High, S)

Fixed by `LLM-1`. While the request is pending, the Stop button should show a
"stopping" state instead of appearing to do nothing.

### UX-2. Device-specific layout is synced across devices (Medium, S)

**Where:** `src/schemas/userPreferences.ts` (`layout.sidebarCollapsed`,
`layout.artifactWidth`, `layout.artifactState`), `ui/App.tsx`,
`ui/hooks/useSidebarState.ts`.

**Problem:** Opening a file or resizing the panel on a phone changes what the
desktop shows on its next load.

**Fix:** Move `layout` to `ui/lib/safeStorage.ts` (device-local). Keep content
and behavior preferences on the server. Update the related browser tests, such
as "two devices share preferences only for the same user" and "narrow windows do
not overwrite the shared artifact width".

**Implementation note:** Shared layout is intentional and has browser tests,
including protection against narrow windows overwriting the shared width.
Device-local storage is a product preference; decide which fields should sync
before changing persistence and the tests that protect it.

### UX-3. Silent failures (Medium, S)

Fixed by `FE-2`. Users should see when Stop, a preference save, or the session
list refresh fails.

### UX-5. "Run" and "chat" are used for the same thing (Low, S)

**Where:** `src/db/sessions.ts` (preview fallback `"New run"`), `ui/App.tsx`
(`"New chat"`), and "run" names throughout the UI.

**Fix:** Use "chat" in all user-visible text. Code identifiers can change
gradually.

### UX-6. Generated-image loading failures have no retry control (Low, S)

**Where:** `ui/components/MarkdownMessage.tsx` (`ComfyUIImageCard`).

**Problem:** A failed generated-image request leaves an error and URL in the
card without a retry action. Uploaded attachment previews already provide a
recoverable loading pattern.

**Fix:** Add an explicit retry action that restarts the image request while
preserving the card's dimensions and showing loading/error state.

**Done when:** A browser test fails the first image request, retries successfully,
and verifies that the layout remains stable.

---

## 12. Testing and CI

### TEST-1. No CI and no pre-commit checks (High, S)

**Fix:** Add a GitHub Actions workflow that runs `bun install --frozen-lockfile`,
`bunx tsc --noEmit`, `bun run lint`, `bun test`, `bun run build`, and
`bun run test:browser` (install Chromium with
`bunx playwright install chromium --no-shell`). Bubblewrap tests already skip
when the sandbox is unavailable. Optionally add a pre-push hook that runs `tsc`,
lint, and `bun test`.

### TEST-2. Playwright projects select tests by name regex (Medium, S)

**Where:** `playwright.config.ts` (the `grep` patterns for the `mobile` and
`desktop` projects).

**Problem:** A new test whose name does not match one of the listed prefixes
never runs, with no warning.

**Fix:** Use Playwright tags (`test("…", { tag: "@mobile" }, …)`) with
`grep: /@mobile/`, or split mobile and desktop tests into directories with
per-project `testDir` or `testMatch`.

### TEST-3. Missing tests for important behavior (Medium, M)

Add these with the related fixes:
1. Stop while a model request is still waiting for a response returns promptly
   (`LLM-1`, new mock OpenRouter scenario).
2. A stalled stream times out and frees the scheduler slot (`LLM-2`).
3. Model-visible tool output is capped for bash, read_file, and grep
   (`TOOL-2`).
4. Requests with an unknown `Host` header are rejected (`SEC-1`).
5. The local workspace download policy is enforced on the single download route
   (`SEC-4`, `API-1`).
6. A failed Stop or preference save shows an error (`FE-2`).
7. An OpenRouter 429 is retried, and a mid-stream error leaves a held, retryable
   turn (`LLM-3`).

### TEST-4. Tests for removed behavior (Low, S)

Delete them with the code they cover: see `LEG-2`, `LEG-3`, and `LEG-9`.

### TEST-5. Fixed polling deadlines can be flaky (Low, S)

**Where:** `until()` helpers with 4-second deadlines, for example in
`tests/e2e/asyncAgents.test.ts`.

**Fix:** Before adding CI, centralize the helper in `tests/helpers` with a
configurable deadline. Prefer waiting on runtime events where practical.

### TEST-6. No disk-backed crash test or complete browser/backend smoke (Medium, M)

**Where:** `tests/env-setup.ts` (in-memory database), `tests/setup.ts`
(mocked external services), and `tests/browser` (intercepted application APIs).

**Problem:** Runtime recovery tests and browser fixtures provide useful coverage,
but neither proves recovery from killing a real process with SQLite/WAL data on
disk, nor the complete browser-to-backend streaming path. The global fetch mock
also returns a successful generic response for unknown external URLs, which can
hide unexpected calls.

**Fix:** Add a subprocess test with a temporary disk database and local fake
provider. Kill it mid-activation, restart, and verify saved transcript/output
recovery without duplicates. Add a small real-backend browser send/stream/reload/
stop smoke. Make unknown external mock requests fail explicitly.

**Done when:** The tests run without paid services and detect persistence or
browser/backend contract failures that intercepted fixtures cannot.

### TEST-7. The unavailable-sandbox assertion differs from the current error (Low, S)

**Where:** `tests/sandbox/SandboxRunner.test.ts` ("fails closed when containment
is unavailable"), `src/sandbox/SandboxRunner.ts` (`spawn`).

**Problem:** The test expects "Shell tools are disabled", but the current runner
throws its capability diagnostic or "Shell containment is unavailable on this
host". This branch was skipped on the audit host because Bubblewrap was available.
The other sandbox restriction and cancellation tests ran successfully.

**Fix:** Exercise unavailable capability deterministically and assert the current
fail-closed contract. Keep this test rather than deleting it as obsolete.

**Done when:** Both available and unavailable containment paths are tested
without depending on which capabilities the developer machine has.

---

## 13. Developer experience, configuration, and dependencies

### DX-1. README deployment instructions are out of date (Low, S)

**Where:** `README.md` ("Deployment (deployctl)").

**Problem:** It says to clone `orbis-agents` with `--name euler`, while the live
deployment is `agents` from `NickAwrist/euler`. It also does not say that
`deployctl update --build` only prepares a release and `deployctl deploy` must
apply it.

**Fix:** Correct the names and document `update --build` followed by `deploy`,
then checking the applied release's source SHA in `deployctl status`.

### DX-2. Configuration is read outside `envConfig` (Low, S)

**Where:** `src/jobs/JobManager.ts` reads `EULER_MAX_SESSION_JOBS` and
`EULER_MAX_OWNER_JOBS` from `process.env` (both undocumented),
`src/db/constants.ts` reads `EULER_DB_PATH`, `EULER_DATA_ROOT`, and
`DEPLOYCTL_DATA_DIR`, and `src/observability/logger.ts` reads `LOG_LEVEL`.

**Fix:** Read all configuration through `src/env.ts` and document each variable
in `.env.example`.

### DX-3. Environment parsing is duplicated in Vite config (Low, S)

**Where:** `vite.config.ts` (`getFirstEnv`, `getPort`) copies `src/env.ts`.

**Fix:** Export small pure helpers from `src/env.ts`, or a `src/envParse.ts`
without side effects, and import them in `vite.config.ts`.

### DX-4. Hard-coded default model (Low, S)

**Where:** `src/constants.ts` (`DEFAULT_RUN_MODEL = "gemma4:e4b"`), used when a
session or agent has no model.

**Problem:** If that model is not installed, the turn fails with an Ollama
error.

**Fix:** Fall back to the user's `defaultModel` preference, and otherwise reject
the request with a clear "choose a model" error.

### DX-5. Unused dependency and dead manifest field (Low, S)

**Where:** `package.json`. `rehype-pretty-code` has no imports, and
`"module": "index.ts"` points to a file that does not exist.

**Fix:** Remove both and run `bun install` to update `bun.lock`.

### DX-6. Invalid environment values silently fall back or partially parse (Low, S)

**Where:** `src/env.ts` and `vite.config.ts` (`getPort`), `src/env.ts`
(`getBoolean`, `getPositiveInteger`).

**Problem:** `Number.parseInt` accepts values such as `3000junk` as port 3000.
Other malformed ports, booleans, and limits silently use defaults. A typo can
therefore change deployment behavior without telling the operator which setting
was invalid. Job limits use stricter Zod parsing, so configuration behavior is
also inconsistent.

**Fix:** Validate nonempty values exactly, name the invalid environment variable
in startup errors, and share the same parsing rules between server and Vite.
Continue treating empty optional values as unset. Combine with `DX-2` and `DX-3`.

**Done when:** Tests cover malformed values, valid overrides, and empty values;
invalid configured values cannot silently select a different port or limit.

---

## Suggested order

1. **Security day:** `SEC-1`, `SEC-3`, `SEC-4` (with `API-1`), then `SEC-2`.
2. **Agent quality:** `TOOL-1`, `TOOL-2`, `LLM-1`, `LLM-2`, `OBS-2`.
3. **Cleanup:** `LEG-1` through `LEG-9`, `TEST-4`, `DX-5`.
4. **Safety net:** `TEST-1`, `TEST-2`.
5. **Contracts:** `TYPE-1`, `TYPE-2`, `TYPE-3`.
6. **Structural:** `ARCH-2` with `FE-1`.

Include `LLM-6`, `LLM-7`, and `API-5` in the early reliability work, `OBS-5`
with logging, and `TEST-6` with the safety net. Investigate `SEC-7` alongside the
security fixes. Preserve the existing safeguards while addressing these gaps.

## Keep as is

These work well. Changes elsewhere should preserve them:
- `RuntimeTransaction` and the design that publishes events only after the
  database commit
- `WorkspaceService`'s symlink-safe file access through `/proc/self/fd`
- The error envelope (`ERROR_MESSAGES`, `sendError`, request IDs)
- Zod contracts in `src/schemas/` shared by the server and UI
- The mock OpenRouter scenarios and HTTP-level integration tests
- The favicon fetcher's SSRF protection
- `AGENTS.md`
