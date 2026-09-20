export type OpenRouterScenario =
  | "streaming"
  | "reasoning"
  | "thinking-tags"
  | "tool-loop"
  | "delayed-stream"
  | "unauthorized"
  | "rate-limit"
  | "corrupted-stream";

type CapturedRequest = {
  headers: Headers;
  body: Record<string, unknown>;
};

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
