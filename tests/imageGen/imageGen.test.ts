import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  createSessionRow,
  ensureUserData,
  getAttachment,
  setOpenRouterApiKey,
  setVercelGatewayApiKey,
} from "../../src/db/index";
import { getUsageDashboard } from "../../src/db/usage";
import { updateUserPreferences } from "../../src/db/userPreferences";
import { ImageProvider as WireImageProvider } from "../../src/gen/euler/v1/preferences_pb";
import {
  generateAndStoreImage,
  listImageModels,
  resetImageModelCaches,
} from "../../src/imageGen/index";
import {
  openRouterImageProvider,
  vercelGatewayImageProvider,
} from "../../src/imageGen/providers";
import { rpc } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function mockFetch(
  impl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  spies.push(
    spyOn(globalThis, "fetch").mockImplementation(
      impl as unknown as typeof fetch,
    ),
  );
}

function usageTotals() {
  return getUsageDashboard(TEST_USER_ID, {
    days: 7,
    providers: [],
    grouping: "model",
    sorting: [{ column: "spend", direction: "descending" }],
    page: 1,
  });
}

function createSession(): string {
  ensureUserData(TEST_USER_ID);
  const id = crypto.randomUUID();
  createSessionRow(TEST_USER_ID, id, Date.now(), "openrouter:test");
  return id;
}

describe("imageGen providers and core", () => {
  test("lists and caches models from OpenRouter and Vercel AI Gateway", async () => {
    const { models, error } = await listImageModels();
    expect(error).toBeUndefined();
    expect(models).toEqual([
      {
        id: "black-forest-labs/flux.2-pro",
        name: "FLUX.2 Pro",
        provider: "openrouter",
        aspectRatios: ["1:1", "16:9"],
        endpoint: "images",
      },
      {
        id: "google/gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image",
        provider: "openrouter",
        aspectRatios: ["1:1", "4:3"],
        endpoint: "images",
      },
      {
        id: "bfl/flux-2-pro",
        name: "FLUX.2 Pro",
        provider: "vercel_gateway",
        aspectRatios: [],
        endpoint: "images",
      },
      {
        id: "google/gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image",
        provider: "vercel_gateway",
        aspectRatios: [],
        endpoint: "chat",
      },
    ]);

    // Text-only models on Vercel Gateway are filtered out.
    expect(models.some((m) => m.id === "anthropic/claude-sonnet-4")).toBe(
      false,
    );

    // RPC filters by provider cleanly.
    const { providers } = rpc();
    const vercelOnly = await providers.listImageModels({
      provider: WireImageProvider.VERCEL_GATEWAY,
    });
    expect(vercelOnly.models.map((m) => m.id)).toEqual([
      "bfl/flux-2-pro",
      "google/gemini-2.5-flash-image",
    ]);
  });

  test("generates via OpenRouter by default when configured and stores a session attachment", async () => {
    const sessionId = createSession();
    setOpenRouterApiKey("sk-or-image-test");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const originalFetch = globalThis.fetch;
    mockFetch(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (init?.method === "POST" && typeof init.body === "string") {
        calls.push({ url, body: JSON.parse(init.body) });
      }
      return originalFetch(input, init);
    });

    const result = await generateAndStoreImage({
      ownerUuid: TEST_USER_ID,
      sessionId,
      prompt: "A red lighthouse at dusk",
      aspectRatio: "16:9",
    });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("black-forest-labs/flux.2-pro");
    expect(result.attachment).toMatchObject({
      kind: "image",
      name: "a-red-lighthouse-at-dusk.png",
      mimeType: "image/png",
    });
    expect(calls).toEqual([
      {
        url: "https://openrouter.ai/api/v1/images",
        body: {
          model: "black-forest-labs/flux.2-pro",
          prompt: "A red lighthouse at dusk",
          image_config: { aspect_ratio: "16:9" },
        },
      },
    ]);

    const stored = getAttachment(TEST_USER_ID, result.attachment.id);
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.data.byteLength).toBeGreaterThan(0);

    const usage = usageTotals();
    expect(usage.totals.cost).toBeCloseTo(0.03, 5);
  });

  test("routes Vercel AI Gateway image models to /images/generations and language models to /chat/completions", async () => {
    const sessionId = createSession();
    setVercelGatewayApiKey("vck-test-key");
    const calls: {
      url: string;
      body: Record<string, unknown>;
      auth: string;
    }[] = [];
    const originalFetch = globalThis.fetch;
    mockFetch(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (init?.method === "POST" && typeof init.body === "string") {
        const headers = new Headers(init.headers);
        calls.push({
          url,
          body: JSON.parse(init.body),
          auth: headers.get("Authorization") ?? "",
        });
      }
      return originalFetch(input, init);
    });

    // 1. Auto-falls back to Vercel when only Vercel is configured; picks image model first.
    const flux = await generateAndStoreImage({
      ownerUuid: TEST_USER_ID,
      sessionId,
      prompt: "Mountain lake",
      aspectRatio: "4:3",
    });
    expect(flux.provider).toBe("vercel_gateway");
    expect(flux.model).toBe("bfl/flux-2-pro");
    expect(flux.attachment.mimeType).toBe("image/png");

    // 2. Selecting a multimodal language model routes through /chat/completions.
    updateUserPreferences(TEST_USER_ID, {
      image: {
        provider: "vercel_gateway",
        model: "google/gemini-2.5-flash-image",
      },
    });
    const gemini = await generateAndStoreImage({
      ownerUuid: TEST_USER_ID,
      sessionId,
      prompt: "Paper crane",
    });
    expect(gemini.provider).toBe("vercel_gateway");
    expect(gemini.model).toBe("google/gemini-2.5-flash-image");
    expect(gemini.attachment.mimeType).toBe("image/png");

    expect(calls).toEqual([
      {
        url: "https://ai-gateway.vercel.sh/v1/images/generations",
        body: {
          model: "bfl/flux-2-pro",
          prompt: "Mountain lake",
          n: 1,
          response_format: "b64_json",
          aspect_ratio: "4:3",
        },
        auth: "Bearer vck-test-key",
      },
      {
        url: "https://ai-gateway.vercel.sh/v1/chat/completions",
        body: {
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: "Paper crane" }],
          modalities: ["text", "image"],
        },
        auth: "Bearer vck-test-key",
      },
    ]);

    const usage = usageTotals();
    expect(usage.totals.cost).toBeCloseTo(0.06, 5);
    expect(
      usage.providers.find((p) => p.key === "vercel_gateway")?.cost,
    ).toBeCloseTo(0.06, 5);
  });

  test("fails cleanly when selected provider has no key or provider returns invalid bytes", async () => {
    const sessionId = createSession();
    await expect(
      generateAndStoreImage({
        ownerUuid: TEST_USER_ID,
        sessionId,
        prompt: "Anything",
      }),
    ).rejects.toThrow(/No image generation provider is configured/);

    setOpenRouterApiKey("sk-or-test");
    updateUserPreferences(TEST_USER_ID, {
      image: { provider: "vercel_gateway", model: "" },
    });
    await expect(
      generateAndStoreImage({
        ownerUuid: TEST_USER_ID,
        sessionId,
        prompt: "Anything",
      }),
    ).rejects.toThrow(/Vercel AI Gateway is selected/);

    // Invalid (non-image) base64 bytes are rejected by magic-byte validation.
    mockFetch(async () =>
      Response.json({
        data: [{ b64_json: Buffer.from("not-an-image").toString("base64") }],
      }),
    );
    await expect(
      openRouterImageProvider.generate({
        model: "black-forest-labs/flux.2-pro",
        prompt: "Bad bytes",
      }),
    ).rejects.toThrow(/unsupported image format/);

    // Remote URL download works and validates magic bytes.
    for (const s of spies.splice(0)) s.mockRestore();
    const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");
    mockFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://openrouter.ai/api/v1/images") {
        return Response.json({
          data: [{ url: "https://cdn.example.com/gen.png" }],
        });
      }
      return new Response(pngBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    const downloaded = await openRouterImageProvider.generate({
      model: "black-forest-labs/flux.2-pro",
      prompt: "From URL",
    });
    expect(downloaded.mimeType).toBe("image/png");
    expect(downloaded.data.byteLength).toBe(pngBytes.byteLength);

    // Provider error message is surfaced cleanly.
    for (const s of spies.splice(0)) s.mockRestore();
    setVercelGatewayApiKey("vck-test");
    resetImageModelCaches();
    mockFetch(async () =>
      Response.json({ error: { message: "Quota exceeded" } }, { status: 429 }),
    );
    await expect(
      vercelGatewayImageProvider.generate({
        model: "bfl/flux-2-pro",
        prompt: "Rate limited",
      }),
    ).rejects.toThrow("Quota exceeded");
  });
});
