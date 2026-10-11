export type OpenRouterScenario =
  | "background-jobs"
  | "async-agents"
  | "agent-question"
  | "blocking-agent"
  | "blocking-question"
  | "streaming"
  | "reasoning"
  | "thinking-tags"
  | "endless-tools"
  | "tool-loop"
  | "tool-outputs"
  | "mcp-tool"
  | "child-outputs"
  | "delayed-stream"
  | "unauthorized"
  | "rate-limit"
  | "corrupted-stream";

type CapturedRequest = {
  headers: Headers;
  body: Record<string, unknown>;
};

let asyncAgentDelay = 100;
export function setAsyncAgentDelay(delay: number) {
  asyncAgentDelay = delay;
}
let scenario: OpenRouterScenario = "streaming";
let requests: CapturedRequest[] = [];

export function setOpenRouterScenario(next: OpenRouterScenario): void {
  scenario = next;
}

export function getOpenRouterRequests(): CapturedRequest[] {
  return requests;
}

export function resetOpenRouterScenario(): void {
  scenario = "streaming";
  requests = [];
}

function sse(payloads: Array<Record<string, unknown> | "[DONE]">): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
        for (const payload of payloads) {
          const data = payload === "[DONE]" ? payload : JSON.stringify(payload);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: "gen-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export async function handleOpenRouterRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const body = (await request.json()) as Record<string, unknown>;
  requests.push({ headers: request.headers, body });

  if (scenario === "background-jobs") {
    const messages = body.messages as Array<{ role: string; content: string }>;
    const lastUser = messages.findLast(
      (m) => m.role === "user" && !m.content.startsWith("<"),
    );
    const last = messages.at(-1);
    if (last?.content.includes('kind="job"'))
      return sse([
        chunk(
          {
            content:
              "The background script finished. JOB_DONE was received automatically.",
          },
          "stop",
        ),
        "[DONE]",
      ]);
    if (last?.role === "tool" || last?.content.startsWith("<background_jobs>"))
      return sse([
        chunk(
          {
            content:
              "The script is running in the background. You can keep chatting.",
          },
          "stop",
        ),
        "[DONE]",
      ]);
    if (lastUser?.content === "How is it going?")
      return sse([
        chunk({ content: "The background script is still running." }, "stop"),
        "[DONE]",
      ]);
    const command = lastUser?.content.startsWith("command:")
      ? lastUser.content.slice(8)
      : "echo JOB_STARTED; sleep 3; echo JOB_PROGRESS; sleep 7; echo JOB_DONE; echo artifact > result.txt";
    return sse([
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: "launch",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({
                  command,
                  background: true,
                  outputFiles: ["result.txt"],
                }),
              },
            },
          ],
        },
        "tool_calls",
      ),
      "[DONE]",
    ]);
  }
  if (scenario === "endless-tools") {
    // Yield like real network I/O so an unbounded loop cannot starve timers.
    await Bun.sleep(1);
    return sse([
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: `loop-${requests.length}`,
              type: "function",
              function: { name: "missing_tool", arguments: "{}" },
            },
          ],
        },
        "tool_calls",
      ),
      "[DONE]",
    ]);
  }

  if (
    scenario === "async-agents" ||
    scenario === "agent-question" ||
    scenario === "blocking-agent" ||
    scenario === "blocking-question"
  ) {
    const messages = body.messages as Array<{
      role: string;
      content: string;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
    const tools = body.tools as Array<{ function: { name: string } }>;
    const main = tools.some((t) => t.function.name === "spawn_agent");
    const called = (name: string) =>
      messages.some((m) => m.tool_calls?.some((t) => t.function.name === name));
    const call = (name: string, args: Record<string, unknown>) =>
      sse([
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: `call-${name}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          "tool_calls",
        ),
        "[DONE]",
      ]);
    if (main) {
      if (messages.some((m) => m.content === "Slow reply"))
        await new Promise((resolve) => setTimeout(resolve, asyncAgentDelay));
      if (!called("spawn_agent"))
        return call("spawn_agent", {
          kind: "general",
          title: "Research",
          prompt: "Find the answer",
          wait: scenario.startsWith("blocking"),
        });
      if (messages.some((m) => m.content.includes('kind="result"')))
        return sse([
          chunk({ content: "The background result is 42." }, "stop"),
          "[DONE]",
        ]);
      if (
        messages.some((m) => m.content.includes('kind="question"')) &&
        !called("send_message")
      ) {
        const question = messages.findLast((m) =>
          m.content.includes('kind="question"'),
        )!;
        const id = /from="([^"]+)"/.exec(question.content)?.[1];
        return call("send_message", { to: id, content: "Proceed" });
      }
      return sse([
        chunk({ content: "Working in the background." }, "stop"),
        "[DONE]",
      ]);
    }
    if (scenario.endsWith("question") && !called("ask_parent"))
      return call("ask_parent", { question: "May I proceed?" });
    await new Promise((resolve) => setTimeout(resolve, asyncAgentDelay));
    return sse([chunk({ content: "42" }, "stop"), "[DONE]"]);
  }
  if (scenario === "unauthorized") {
    return Response.json(
      { error: { code: 401, message: "Invalid API key" } },
      { status: 401 },
    );
  }
  if (scenario === "rate-limit") {
    return Response.json(
      { error: { code: 429, message: "Rate limit exceeded" } },
      { status: 429 },
    );
  }
  if (scenario === "corrupted-stream") {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(chunk({ content: "Hi" }))}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: {not-json}\n\n"));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }
  if (scenario === "delayed-stream") {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(chunk({ content: "Hello" }))}\n\n`,
            ),
          );
          setTimeout(() => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(chunk({ content: " after closing the app." }, "stop"))}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }, 75);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }
  if (scenario === "reasoning") {
    return sse([
      chunk({ reasoning: "Checking assumptions. " }),
      chunk({
        reasoning_details: [
          {
            type: "reasoning.summary",
            summary: "Comparing",
            id: "reasoning-1",
            format: "test",
            index: 0,
          },
        ],
      }),
      chunk({
        reasoning_details: [
          {
            type: "reasoning.summary",
            summary: " options.",
            id: "reasoning-1",
            format: "test",
            index: 0,
          },
        ],
      }),
      chunk({ content: "Reasoned answer." }, "stop"),
      {
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 7,
          total_tokens: 19,
          cost: 0.00084,
        },
      },
      "[DONE]",
    ]);
  }
  if (scenario === "thinking-tags") {
    return sse([
      chunk({ content: "<tho" }),
      chunk({ content: "ught>Private thought" }),
      chunk({ content: "</thought>Public answer" }, "stop"),
      "[DONE]",
    ]);
  }
  if (scenario === "tool-loop" && requests.length === 1) {
    return sse([
      chunk({
        reasoning_details: [
          {
            type: "reasoning.summary",
            summary: "I should",
            id: "tool-reasoning-1",
            format: "test",
            index: 0,
          },
        ],
        tool_calls: [
          {
            index: 0,
            id: "call_test_1",
            type: "function",
            function: { name: "missing_", arguments: "" },
          },
        ],
      }),
      chunk({
        reasoning_details: [
          {
            type: "reasoning.summary",
            summary: " use a tool.",
            id: "tool-reasoning-1",
            format: "test",
            index: 0,
          },
        ],
      }),
      chunk({
        tool_calls: [
          {
            index: 0,
            function: { name: "tool", arguments: '{"value":' },
          },
        ],
      }),
      chunk(
        {
          tool_calls: [{ index: 0, function: { arguments: "42}" } }],
        },
        "tool_calls",
      ),
      "[DONE]",
    ]);
  }
  if (scenario === "tool-loop") {
    return sse([chunk({ content: "Finished after tool." }, "stop"), "[DONE]"]);
  }
  if (scenario === "mcp-tool") {
    return sse([
      requests.length === 1
        ? chunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: "call_mcp_0",
                  type: "function",
                  function: {
                    name: "mcp__test__echo",
                    arguments: JSON.stringify({ text: "hello" }),
                  },
                },
              ],
            },
            "tool_calls",
          )
        : chunk({ content: "Echoed." }, "stop"),
      "[DONE]",
    ]);
  }
  if (
    (scenario === "tool-outputs" || scenario === "child-outputs") &&
    requests.length === 1
  ) {
    // The repeated search returns the same source to exercise deduplication.
    const calls = [
      ["generate_image", { prompt: "A lighthouse" }],
      ["web_search", { query: "lighthouses" }],
      ...(scenario === "child-outputs"
        ? ([
            [
              "create_file",
              { path: "report.txt", content: "Lighthouse report" },
            ],
            ["ask_parent", { question: "May I finish?" }],
          ] as const)
        : []),
      ["web_search", { query: "lighthouses" }],
    ] as const;
    return sse([
      chunk(
        {
          tool_calls: calls.map(([name, args], index) => ({
            index,
            id: `call_output_${index}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          })),
        },
        "tool_calls",
      ),
      "[DONE]",
    ]);
  }
  if (scenario === "tool-outputs") {
    return sse([
      chunk({ content: "Here is the lighthouse and my sources." }, "stop"),
      "[DONE]",
    ]);
  }

  return sse([
    chunk({ content: "Hello" }),
    chunk({ content: " from OpenRouter." }, "stop"),
    {
      choices: [],
      usage: {
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 8 },
        completion_tokens: 5,
        total_tokens: 15,
        cost: 0.00042,
      },
    },
    "[DONE]",
  ]);
}
