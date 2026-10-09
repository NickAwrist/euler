import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "perf-model:latest";
const USER_ID = "e4553255-0601-46f7-93c6-e69c3c768d2c";
const SESSIONS = 100;
const LONG_SESSIONS = 2;
const LONG_MESSAGES = 200;

interface OpenStream {
  push: (line: object) => void;
  end: () => void;
}

const streams: OpenStream[] = [];

function chatLine(content: string, done: boolean) {
  return {
    model: MODEL,
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
    done,
    ...(done
      ? { done_reason: "stop", prompt_eval_count: 10, eval_count: 10 }
      : {}),
  };
}

/** A fake Ollama whose streamed chat replies advance only through the control port. */
const ollama = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/tags")
      return Response.json({
        models: [
          {
            name: MODEL,
            model: MODEL,
            modified_at: "2026-01-01T00:00:00Z",
            size: 1,
            digest: "fixture",
            details: { family: "llama", parameter_size: "8B" },
          },
        ],
      });
    if (pathname === "/api/show")
      return Response.json({ capabilities: ["completion", "tools"] });
    if (pathname !== "/api/chat")
      return new Response("Not found", { status: 404 });
    const body = (await request.json()) as { stream?: boolean };
    if (body.stream === false)
      return Response.json(chatLine("Fixture reply", true));
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream: OpenStream = {
      push: (line) =>
        controller?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
      end: () => {
        stream.push(chatLine("", true));
        controller?.close();
      },
    };
    streams.push(stream);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { headers: { "Content-Type": "application/x-ndjson" } },
    );
  },
});

// Set isolation before importing anything that opens the database.
const workspace = await mkdtemp(join(tmpdir(), "euler-performance-"));
Object.assign(process.env, {
  EULER_DB_PATH: join(workspace, "euler.sqlite"),
  EULER_DATA_ROOT: join(workspace, "data"),
  EULER_OLLAMA_HOST: `http://127.0.0.1:${ollama.port}`,
  EULER_COMFYUI_HOST: "",
  EULER_OPENROUTER_API_KEY: "",
  OPENROUTER_API_KEY: "",
  EULER_BRAVE_SEARCH_API_KEY: "",
  BRAVE_SEARCH_API_KEY: "",
  EULER_SERVE_FRONTEND: "true",
});
const { app } = await import("../../src/app");
const sessions = await import("../../src/db/sessions");
const { ensureUserData } = await import("../../src/db/users");
const { updateUserPreferences } = await import("../../src/db/userPreferences");

const REPLY_BODY = [
  "A paragraph with **bold**, [a link](https://example.com), and `inline code`.\n\n".repeat(
    4,
  ),
  "```ts\nexport function add(a: number, b: number) {\n  return a + b;\n}\n```\n\n",
  "| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n- one\n- two\n- three",
].join("");
const reply = (index: number) => `Reply ${index}\n\n${REPLY_BODY}`;
const steps = [
  { kind: "llm_call", status: "completed", turnIndex: 0 },
  {
    kind: "tool_call",
    status: "completed",
    toolName: "read_file",
    args: { path: "README.md" },
    result: "ok",
  },
  { kind: "llm_call", status: "completed", turnIndex: 1 },
];

ensureUserData(USER_ID);
updateUserPreferences(USER_ID, { settings: { defaultModel: MODEL } });
const sessionIds: string[] = [];
// Seconds apart, so every chat falls in the same sidebar date group.
const base = Date.now() - SESSIONS * 1000;
for (let index = 0; index < SESSIONS; index++) {
  const id = crypto.randomUUID();
  const updatedAt = base + index * 1000;
  sessions.createSessionRow(USER_ID, id, updatedAt, MODEL);
  const count = index >= SESSIONS - LONG_SESSIONS ? LONG_MESSAGES : 4;
  for (let position = 0; position < count; position++)
    sessions.appendRuntimeMessage(
      USER_ID,
      id,
      position % 2 === 0
        ? { role: "user", content: `Question ${position}: explain it.` }
        : { role: "assistant", content: reply(position), steps },
    );
  sessions.patchSessionRow(USER_ID, id, {
    title: `Session ${index}`,
    updated_at: updatedAt,
  });
  sessions.markSessionViewed(USER_ID, id);
  sessionIds.push(id);
}

const server = app.listen(Number(process.env.PERF_PORT), "127.0.0.1");

const control = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/streams") return Response.json({ open: streams.length });
    const stream = streams.at(-1);
    if (!stream) return new Response("No open stream", { status: 409 });
    if (pathname === "/chunk") {
      const { content } = (await request.json()) as { content: string };
      stream.push(chatLine(content, false));
      return Response.json({ ok: true });
    }
    if (pathname === "/finish") {
      streams.pop();
      stream.end();
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(
  JSON.stringify({
    userId: USER_ID,
    workspace,
    controlPort: control.port,
    // Newest first, as the sidebar lists them.
    longSessions: sessionIds.slice(-LONG_SESSIONS).reverse(),
  }),
);

process.on("SIGTERM", () => {
  server.close();
  control.stop(true);
  ollama.stop(true);
  process.exit(0);
});
