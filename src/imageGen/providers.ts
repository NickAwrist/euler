import { z } from "zod";
import { getOpenRouterApiKey, getVercelGatewayApiKey } from "../db/index";
import {
  CATALOG_TIMEOUT_MS,
  CachedImageCatalog,
  type GeneratedImage,
  type ImageGenerationRequest,
  type ImageModel,
  type ImageProvider,
  decodeImageItem,
  postJson,
} from "./types";

const OPENROUTER_IMAGE_MODELS_URL =
  "https://openrouter.ai/api/v1/images/models";
const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const VERCEL_IMAGES_URL = "https://ai-gateway.vercel.sh/v1/images/generations";
const VERCEL_CHAT_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

const UsageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    cost: z.number().optional(),
  })
  .optional();

/** Shared response schema for both OpenRouter `/api/v1/images` and Vercel `/v1/images/generations`. */
const ImageApiResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .min(1),
  usage: UsageSchema,
});

const ChatImageResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          images: z
            .array(
              z.object({
                image_url: z.object({ url: z.string() }).optional(),
                url: z.string().optional(),
              }),
            )
            .optional(),
          content: z
            .union([
              z.string(),
              z.array(
                z.object({
                  type: z.string(),
                  image_url: z.object({ url: z.string() }).optional(),
                }),
              ),
            ])
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: UsageSchema,
});

const OpenRouterImageCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1),
      supported_parameters: z
        .object({
          aspect_ratio: z
            .object({ values: z.array(z.string()).optional() })
            .optional(),
        })
        .nullish(),
    }),
  ),
});

const VercelModelsCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1).optional(),
      type: z.string().optional(),
      modalities: z
        .object({
          output: z.array(z.string()).optional(),
        })
        .nullish(),
    }),
  ),
});

function usageFields(usage: z.infer<typeof UsageSchema>) {
  if (!usage) return {};
  return {
    ...(typeof usage.cost === "number" ? { cost: usage.cost } : {}),
    ...(typeof usage.prompt_tokens === "number"
      ? { promptTokens: usage.prompt_tokens }
      : {}),
    ...(typeof usage.completion_tokens === "number"
      ? { outputTokens: usage.completion_tokens }
      : {}),
  };
}

async function decodeImagesResponse(
  payload: unknown,
  label: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const parsed = ImageApiResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`${label} returned an invalid image response`);
  }
  const image = await decodeImageItem(parsed.data.data[0]!, label, signal);
  return { ...image, ...usageFields(parsed.data.usage) };
}

async function decodeChatImageResponse(
  payload: unknown,
  label: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const parsed = ChatImageResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`${label} returned an invalid image response`);
  }
  const message = parsed.data.choices[0]!.message;
  const fromImages =
    message.images?.[0]?.image_url?.url ?? message.images?.[0]?.url;
  const fromContent = Array.isArray(message.content)
    ? message.content.find(
        (part) => part.type === "image_url" && part.image_url,
      )?.image_url?.url
    : undefined;
  const url = fromImages ?? fromContent;
  if (!url) {
    throw new Error(`${label} did not return an image in the reply`);
  }
  const image = await decodeImageItem({ url }, label, signal);
  return { ...image, ...usageFields(parsed.data.usage) };
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

const openRouterCatalog = new CachedImageCatalog(async () => {
  const response = await fetch(OPENROUTER_IMAGE_MODELS_URL, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter image catalog failed (${response.status})`);
  }
  const { data } = OpenRouterImageCatalogSchema.parse(await response.json());
  return data.map((model) => ({
    id: model.id,
    name: model.name.replace(/^[^:]+:\s*/, ""),
    provider: "openrouter" as const,
    aspectRatios: model.supported_parameters?.aspect_ratio?.values ?? [],
    endpoint: "images" as const,
  }));
});

export const openRouterImageProvider: ImageProvider = {
  id: "openrouter",
  label: "OpenRouter",
  isConfigured: () => getOpenRouterApiKey().length > 0,
  listModels: (refresh) => openRouterCatalog.get(refresh),
  resetCache: () => openRouterCatalog.reset(),
  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) throw new Error("OpenRouter API key is not configured");
    const payload = await postJson(
      OPENROUTER_IMAGES_URL,
      {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost",
        "X-Title": "Euler",
      },
      {
        model: request.model,
        prompt: request.prompt,
        ...(request.aspectRatio
          ? { image_config: { aspect_ratio: request.aspectRatio } }
          : {}),
      },
      this.label,
      request.signal,
    );
    return decodeImagesResponse(payload, this.label, request.signal);
  },
};

// ---------------------------------------------------------------------------
// Vercel AI Gateway
// ---------------------------------------------------------------------------

const vercelGatewayCatalog = new CachedImageCatalog(async () => {
  const response = await fetch(VERCEL_MODELS_URL, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Vercel AI Gateway model catalog failed (${response.status})`,
    );
  }
  const { data } = VercelModelsCatalogSchema.parse(await response.json());
  return data
    .filter(
      (model) =>
        model.type === "image" ||
        (model.modalities?.output?.includes("image") ?? false),
    )
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: "vercel_gateway" as const,
      aspectRatios: [],
      endpoint:
        model.type === "language" ? ("chat" as const) : ("images" as const),
    }));
});

async function resolveVercelEndpoint(
  modelId: string,
): Promise<"images" | "chat"> {
  const cached = vercelGatewayCatalog.peek();
  const entry = cached?.find((model) => model.id === modelId);
  if (entry?.endpoint) return entry.endpoint;
  try {
    const models = await vercelGatewayCatalog.get();
    const fetched = models.find((model) => model.id === modelId);
    if (fetched?.endpoint) return fetched.endpoint;
  } catch {
    // Fall back to heuristic if catalog fetch fails while generating.
  }
  return modelId.startsWith("google/gemini") ? "chat" : "images";
}

export const vercelGatewayImageProvider: ImageProvider = {
  id: "vercel_gateway",
  label: "Vercel AI Gateway",
  isConfigured: () => getVercelGatewayApiKey().length > 0,
  listModels: (refresh) => vercelGatewayCatalog.get(refresh),
  resetCache: () => vercelGatewayCatalog.reset(),
  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const apiKey = getVercelGatewayApiKey();
    if (!apiKey) {
      throw new Error("Vercel AI Gateway API key is not configured");
    }
    const headers = { Authorization: `Bearer ${apiKey}` };
    const endpoint = await resolveVercelEndpoint(request.model);
    if (endpoint === "chat") {
      const payload = await postJson(
        VERCEL_CHAT_URL,
        headers,
        {
          model: request.model,
          messages: [{ role: "user", content: request.prompt }],
          modalities: ["text", "image"],
          ...(request.aspectRatio
            ? { image_config: { aspect_ratio: request.aspectRatio } }
            : {}),
        },
        this.label,
        request.signal,
      );
      return decodeChatImageResponse(payload, this.label, request.signal);
    }
    const payload = await postJson(
      VERCEL_IMAGES_URL,
      headers,
      {
        model: request.model,
        prompt: request.prompt,
        n: 1,
        response_format: "b64_json",
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      },
      this.label,
      request.signal,
    );
    return decodeImagesResponse(payload, this.label, request.signal);
  },
};
