import "./env-setup";
import { afterEach, beforeEach } from "bun:test";
import { resetDbConnection } from "../src/db";
import {
  handleOpenRouterRequest,
  resetOpenRouterScenario,
} from "./helpers/mockOpenRouter";

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

    if (pathname.endsWith("/api/chat")) {
      return new Response(
        JSON.stringify({
          model: "llama3:latest",
          created_at: new Date().toISOString(),
          message: {
            role: "assistant",
            content: "Mocked Ollama response content",
          },
          done: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 2. ComfyUI mocks
    if (pathname.endsWith("/system_stats")) {
      return new Response(
        JSON.stringify({
          system: {
            os: "linux",
            ram_total: 16777216,
            ram_free: 8388608,
          },
          devices: [
            {
              name: "cuda",
              type: "cuda",
              vram_total: 8589934592,
              vram_free: 4294967296,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (pathname.endsWith("/prompt")) {
      return new Response(
        JSON.stringify({
          prompt_id: "mock-prompt-123",
          number: 1,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (pathname.includes("/history/")) {
      const promptId = pathname.split("/history/")[1] || "";
      return new Response(
        JSON.stringify({
          [promptId]: {
            outputs: {
              "9": {
                images: [
                  {
                    filename: "mock_image.png",
                    subfolder: "",
                    type: "output",
                  },
                ],
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (pathname.endsWith("/object_info/CheckpointLoaderSimple")) {
      return new Response(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: {
              required: {
                ckpt_name: [["v1-5-pruned-emaonly.ckpt"], {}],
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 3. SearXNG mock
    if (pathname.endsWith("/search")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Mocked Search Result 1",
              url: "https://example.com/result1",
              content: "This is a mocked search result from SearXNG.",
              engine: "google",
            },
          ],
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
});

afterEach(() => {
  resetDbConnection();
  resetOpenRouterScenario();
});
