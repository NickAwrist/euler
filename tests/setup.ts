import "./env-setup";
import { afterEach, beforeEach } from "bun:test";
import { resetDbConnection } from "../src/db";
import { resetImageModelCaches } from "../src/imageGen/index";
import { vercelGatewayCatalog } from "../src/models/openRouterModels";
import {
  handleOpenRouterRequest,
  resetOpenRouterScenario,
} from "./helpers/mockOpenRouter";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";

const originalFetch = globalThis.fetch;

(globalThis as unknown as { fetch: unknown }).fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  let urlString = "";
  if (typeof input === "string") {
    urlString = input;
  } else if (input instanceof URL) {
    urlString = input.toString();
  } else if (input instanceof Request) {
    urlString = input.url;
  }

  // Allow local test server calls to pass through
  if (
    urlString.includes("127.0.0.1") ||
    urlString.includes("localhost") ||
    urlString.includes("::1")
  ) {
    return originalFetch(input, init);
  }

  try {
    const url = new URL(urlString);
    const pathname = url.pathname;

    // 1. Ollama mocks
    if (pathname.endsWith("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3:latest",
              model: "llama3:latest",
              details: {
                parent_model: "",
                format: "gguf",
                family: "llama",
                families: ["llama"],
                parameter_size: "8B",
                quantization_level: "Q4_0",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (pathname.endsWith("/api/show")) {
      return Response.json({
        capabilities: ["completion", "vision", "tools"],
      });
    }

    // 2. Brave Search mock
    if (urlString.startsWith("https://api.search.brave.com/")) {
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Mocked Search Result 1",
                url: "https://example.com/result1",
                description: "This is a mocked search result from Brave.",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 4. OpenRouter mocks
    if (urlString === "https://openrouter.ai/api/v1/models") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "example/test-model",
              name: "Example AI: Test Model",
              created: 1700000000,
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
            {
              id: "openai/gpt-5.4-mini",
              name: "OpenAI: GPT-5.4 Mini",
              created: 1700000000,
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
            {
              id: "openai/gpt-5.6-terra",
              name: "OpenAI: GPT-5.6 Terra",
              created: 1700000000,
              supported_parameters: ["tools"],
              context_length: 128000,
              pricing: { prompt: "0", completion: "0.000002" },
              architecture: {
                input_modalities: ["text", "image", "future-input"],
                output_modalities: ["text"],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (urlString === "https://openrouter.ai/api/v1/images/models") {
      return Response.json({
        data: [
          {
            id: "black-forest-labs/flux.2-pro",
            name: "Black Forest Labs: FLUX.2 Pro",
            supported_parameters: {
              aspect_ratio: { values: ["1:1", "16:9"] },
            },
          },
          {
            id: "google/gemini-2.5-flash-image",
            name: "Google: Gemini 2.5 Flash Image",
            supported_parameters: {
              aspect_ratio: { values: ["1:1", "4:3"] },
            },
          },
        ],
      });
    }

    if (urlString === "https://openrouter.ai/api/v1/images") {
      return Response.json({
        data: [{ b64_json: TINY_PNG_BASE64, media_type: "image/png" }],
        usage: { prompt_tokens: 10, completion_tokens: 0, cost: 0.03 },
      });
    }

    if (urlString === "https://ai-gateway.vercel.sh/v1/models") {
      return Response.json({
        data: [
          {
            id: "bfl/flux-2-pro",
            name: "FLUX.2 Pro",
            type: "image",
          },
          {
            id: "google/gemini-2.5-flash-image",
            name: "Gemini 2.5 Flash Image",
            type: "language",
            released: 1742428800,
            context_window: 32768,
            modalities: { input: ["text", "image"], output: ["text", "image"] },
            pricing: { input: "0.0000003", output: "0.0000025" },
          },
          {
            id: "anthropic/claude-sonnet-4",
            name: "Claude Sonnet 4",
            type: "language",
            created: 1755815280,
            released: 1747872000,
            context_window: 200000,
            tags: ["reasoning", "tool-use", "vision"],
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            supported_parameters: ["tools", "reasoning"],
            reasoning_options: [
              { type: "toggle" },
              { type: "effort", values: ["low", "medium", "high"] },
            ],
            pricing: {
              input: "0.000003",
              output: "0.000015",
              input_cache_read: "0.0000003",
            },
          },
        ],
      });
    }

    if (urlString === "https://ai-gateway.vercel.sh/v1/credits") {
      return Response.json({ balance: "12.50", total_used: "3.25" });
    }

    if (urlString === "https://ai-gateway.vercel.sh/v1/images/generations") {
      return Response.json({
        data: [{ b64_json: TINY_PNG_BASE64 }],
        usage: { cost: 0.04 },
      });
    }

    if (urlString === "https://ai-gateway.vercel.sh/v1/chat/completions") {
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { stream?: boolean })
          : undefined;
      if (body?.stream) {
        return await handleOpenRouterRequest(input, init);
      }
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              images: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${TINY_PNG_BASE64}`,
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 100, cost: 0.02 },
      });
    }

    if (urlString.includes("openrouter.ai/api/v1/chat/completions")) {
      return await handleOpenRouterRequest(input, init);
    }

    // Default mock response for other external URLs
    return new Response(
      JSON.stringify({ message: "Mocked external request" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to parse URL or mock request" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

beforeEach(() => {
  resetDbConnection();
  resetOpenRouterScenario();
  resetImageModelCaches();
  vercelGatewayCatalog.reset();
});

afterEach(() => {
  resetDbConnection();
  resetOpenRouterScenario();
  resetImageModelCaches();
  vercelGatewayCatalog.reset();
});
