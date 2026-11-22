import type { ImageAttachment, ImageMimeType } from "../attachments/types";
import { createImageAttachment } from "../db/index";
import { recordUsage } from "../db/usage";
import { effectiveUserPreferences } from "../db/userPreferences";
import { errorMessage } from "../utils/errors";
import {
  openRouterImageProvider,
  vercelGatewayImageProvider,
} from "./providers";
import type { ImageModel, ImageProvider, ImageProviderId } from "./types";

export type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageModel,
  ImageProvider,
  ImageProviderId,
} from "./types";

export const IMAGE_PROVIDERS: readonly ImageProvider[] = [
  openRouterImageProvider,
  vercelGatewayImageProvider,
];

export function getImageProvider(id: ImageProviderId): ImageProvider {
  const provider = IMAGE_PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown image provider: ${id}`);
  return provider;
}

export function configuredImageProviders(): ImageProvider[] {
  return IMAGE_PROVIDERS.filter((provider) => provider.isConfigured());
}

export function resetImageModelCaches(): void {
  for (const provider of IMAGE_PROVIDERS) provider.resetCache();
}

export async function listImageModels(
  providerId?: ImageProviderId,
  refresh = false,
): Promise<{ models: ImageModel[]; error?: string }> {
  const targets = providerId
    ? [getImageProvider(providerId)]
    : [...IMAGE_PROVIDERS];
  const results = await Promise.allSettled(
    targets.map((provider) => provider.listModels(refresh)),
  );
  const models: ImageModel[] = [];
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      models.push(...result.value);
    } else {
      errors.push(`${targets[index]!.label}: ${errorMessage(result.reason)}`);
    }
  });
  return {
    models,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

const MIME_EXTENSIONS: Record<ImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function generatedFilename(prompt: string, mimeType: ImageMimeType): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "generated-image"}.${MIME_EXTENSIONS[mimeType]}`;
}

export type StoredImageResult = {
  attachment: ImageAttachment;
  provider: ImageProviderId;
  providerLabel: string;
  model: string;
};

/**
 * Resolves the user's configured provider and model, generates the image,
 * records usage when reported, and stores the bytes as a session attachment.
 */
export async function generateAndStoreImage(input: {
  ownerUuid: string;
  sessionId: string;
  prompt: string;
  aspectRatio?: string;
  signal?: AbortSignal;
}): Promise<StoredImageResult> {
  const pref = input.ownerUuid
    ? effectiveUserPreferences(input.ownerUuid).image
    : { provider: "" as const, model: "" };

  let provider: ImageProvider;
  if (pref.provider) {
    provider = getImageProvider(pref.provider);
    if (!provider.isConfigured()) {
      throw new Error(
        `${provider.label} is selected for image generation, but its API key is not configured`,
      );
    }
  } else {
    const first = configuredImageProviders()[0];
    if (!first) {
      throw new Error(
        "No image generation provider is configured. Add an OpenRouter or Vercel AI Gateway API key in Settings.",
      );
    }
    provider = first;
  }

  let model = pref.model.trim();
  if (!model) {
    const models = await provider.listModels();
    if (models.length === 0) {
      throw new Error(
        `No image generation models available on ${provider.label}`,
      );
    }
    model = models[0]!.id;
  }

  const generated = await provider.generate({
    model,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    signal: input.signal,
  });

  if (
    input.ownerUuid &&
    (generated.cost !== undefined ||
      generated.promptTokens !== undefined ||
      generated.outputTokens !== undefined)
  ) {
    recordUsage(input.ownerUuid, `${provider.id}:${model}`, {
      cost: generated.cost,
      promptTokens: generated.promptTokens,
      outputTokens: generated.outputTokens,
    });
  }

  const attachment = createImageAttachment({
    ownerUuid: input.ownerUuid,
    sessionId: input.sessionId,
    name: generatedFilename(input.prompt, generated.mimeType),
    mimeType: generated.mimeType,
    data: generated.data,
  });

  return {
    attachment,
    provider: provider.id,
    providerLabel: provider.label,
    model,
  };
}
