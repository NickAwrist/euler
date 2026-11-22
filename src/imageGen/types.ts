import { detectImageMimeType } from "../attachments/images";
import { type ImageMimeType, MAX_IMAGE_BYTES } from "../attachments/types";
import { errorMessage } from "../utils/errors";

export type ImageProviderId = "openrouter" | "vercel_gateway";

export type ImageModel = {
  id: string;
  name: string;
  provider: ImageProviderId;
  aspectRatios: string[];
  /** Multimodal chat models on gateways that route them through /chat/completions. */
  endpoint?: "images" | "chat";
};

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  aspectRatio?: string;
  signal?: AbortSignal;
};

export type GeneratedImage = {
  data: Uint8Array;
  mimeType: ImageMimeType;
  cost?: number;
  promptTokens?: number;
  outputTokens?: number;
};

export interface ImageProvider {
  readonly id: ImageProviderId;
  readonly label: string;
  isConfigured(): boolean;
  listModels(refresh?: boolean): Promise<ImageModel[]>;
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
  resetCache(): void;
}

const CATALOG_TTL_MS = 2 * 60 * 60 * 1000;
export const CATALOG_TIMEOUT_MS = 15_000;
const GENERATE_TIMEOUT_MS = 120_000;

/** TTL-cached, in-flight coalesced catalog shared by image generation providers. */
export class CachedImageCatalog {
  private snapshot: { models: ImageModel[]; fetchedAt: number } | null = null;
  private inFlight: Promise<ImageModel[]> | null = null;

  constructor(private readonly load: () => Promise<ImageModel[]>) {}

  peek(): ImageModel[] | null {
    return this.snapshot?.models ?? null;
  }

  reset(): void {
    this.snapshot = null;
    this.inFlight = null;
  }

  async get(refresh = false): Promise<ImageModel[]> {
    if (this.inFlight) return this.inFlight;
    if (
      !refresh &&
      this.snapshot &&
      Date.now() - this.snapshot.fetchedAt < CATALOG_TTL_MS
    ) {
      return this.snapshot.models;
    }
    const request = this.load()
      .then((models) => {
        this.snapshot = { models, fetchedAt: Date.now() };
        return models;
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = null;
      });
    this.inFlight = request;
    return request;
  }
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function extractProviderError(
  body: unknown,
  status: number,
  label: string,
): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `${label} image request failed (${status})`;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: combineSignal(signal, GENERATE_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractProviderError(payload, response.status, label));
  }
  return payload;
}

function decodeBase64(raw: string): Uint8Array {
  const stripped = raw.replace(/^data:[^;]+;base64,/, "").trim();
  const buffer = Buffer.from(stripped, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Decodes a provider image item (`b64_json`, `data:` URL, or remote URL) into validated bytes. */
export async function decodeImageItem(
  item: { b64_json?: string; url?: string },
  label: string,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; mimeType: ImageMimeType }> {
  let data: Uint8Array;
  if (item.b64_json) {
    data = decodeBase64(item.b64_json);
  } else if (item.url?.startsWith("data:")) {
    if (!item.url.includes(";base64,")) {
      throw new Error(`${label} returned an unsupported data URL`);
    }
    data = decodeBase64(item.url);
  } else if (item.url && /^https?:\/\//i.test(item.url)) {
    let response: Response;
    try {
      response = await fetch(item.url, {
        signal: combineSignal(signal, 30_000),
      });
    } catch (error) {
      throw new Error(
        `Failed to download image from ${label}: ${errorMessage(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Failed to download image from ${label} (${response.status})`,
      );
    }
    data = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error(`${label} returned no image data`);
  }

  if (data.byteLength === 0) {
    throw new Error(`${label} returned an empty image`);
  }
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `${label} returned an image larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MiB`,
    );
  }
  const mimeType = detectImageMimeType(data);
  if (!mimeType) {
    throw new Error(`${label} returned an unsupported image format`);
  }
  return { data, mimeType };
}
