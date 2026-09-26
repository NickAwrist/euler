import "../setup";
import { describe, expect, spyOn, test } from "bun:test";
import {
  getOpenRouterApiKey,
  listOpenRouterModels,
  setOllamaHost,
  setOpenRouterApiKey,
} from "../../src/db";
import {
  listModelFavorites,
  setModelFavorite,
  setOpenRouterModelEnabled,
} from "../../src/db/openrouter";
import {
  type CatalogResult,
  normalizeCatalog,
  openRouterCatalog,
} from "../../src/openRouterModels";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { startTestServer, userHeaders } from "../helpers/server";

const runBody = (model: string) => ({
  ephemeral: true,
  message: "Hello",
  history: [],
  model,
});

describe("OpenRouter API integration", () => {
  test("exposes a provider-aware model catalog even when one provider fails", async () => {
    setOllamaHost("http://ollama.test");
    setOpenRouterApiKey("");
    const { url, close } = await startTestServer();
    try {
      let response = await fetch(`${url}/api/models`);
      expect(response.status).toBe(200);
      let body = (await response.json()) as {
        models: Array<{
          id: string;
          provider: string;
          configured?: boolean;
          inputCapabilities?: string[];
          supportsTools?: boolean;
        }>;
      };
      expect(
        body.models.find((model) => model.provider === "ollama"),
      ).toMatchObject({
        inputCapabilities: ["text", "image"],
        supportsTools: true,
      });
      expect(
        body.models.some((model) => model.provider === "openrouter"),
      ).toBeFalse();

      await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ apiKey: "sk-or-api-test" }),
      });
      await fetch(`${url}/api/settings/openrouter/catalog`);
      await fetch(`${url}/api/settings/openrouter/models`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: "openai/gpt-5.6-terra", enabled: true }),
      });
      response = await fetch(`${url}/api/models`);
      body = await response.json();
      expect(
        body.models
          .filter((model) => model.provider === "openrouter")
          .every((model) => model.configured === true),
      ).toBeTrue();
      expect(
        body.models.find(
          (model) => model.id === "openrouter:openai/gpt-5.6-terra",
        )?.inputCapabilities,
      ).toEqual(["text", "image"]);
    } finally {
      await close();
    }
  });

  test("manages activation and independent favorites through settings", async () => {
    const { url, close } = await startTestServer();
    const request = (path: string, method: string, body: unknown) =>
      fetch(`${url}/api/settings/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      const route = "example/test-model";
      await fetch(`${url}/api/settings/openrouter/catalog`);
      expect(
        (
          await request("models/favorite", "PUT", {
            provider: "openrouter",
            modelId: route,
            favorite: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request("models/favorite", "PUT", {
            provider: "openrouter",
            modelId: `openrouter:${route}`,
            favorite: true,
          })
        ).status,
      ).toBe(400);
      expect(listOpenRouterModels()).toHaveLength(0);
      expect(
        (await request("openrouter/models", "PATCH", { route, enabled: false }))
          .status,
      ).toBe(200);
      expect(listOpenRouterModels()[0]?.enabled).toBe(0);
      expect(
        (await request("openrouter/models", "PATCH", { route, enabled: true }))
          .status,
      ).toBe(200);
      const response = await fetch(
        `${url}/api/settings/openrouter/publishers/example/models`,
      );
      expect(await response.json()).toMatchObject({
        models: [{ route, enabled: true, favorite: true }],
      });
      expect(
        (
          await request("openrouter/models", "PATCH", {
            route: "unknown/model",
            enabled: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request("openrouter/publishers", "POST", {
            publisherId: "invented",
          })
        ).status,
      ).toBe(400);
      const removed = await fetch(
        `${url}/api/settings/openrouter/publishers/example`,
        { method: "DELETE" },
      );
      expect(removed.status).toBe(200);
      expect(listOpenRouterModels()[0]?.enabled).toBe(0);
      expect(
        listModelFavorites().some((favorite) => favorite.model_id === route),
      ).toBeTrue();
      expect(
        (
          await request("openrouter/publishers", "POST", {
            publisherId: "example",
          })
        ).status,
      ).toBe(200);
      expect(listOpenRouterModels()[0]?.enabled).toBe(0);
    } finally {
      await close();
    }
  });

  test("outages allow local changes and successful removal only affects composer availability", async () => {
    const model = normalizeCatalog({
      data: [
        {
          id: "openai/test",
          name: "Test",
          created: 100,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    })[0]!;
    setOpenRouterModelEnabled(model, true);
    setModelFavorite("openrouter", model.route, true);
    setOpenRouterApiKey("key");
    let catalog: CatalogResult = {
      status: "unavailable",
      models: null,
      lastSuccessfulFetchAt: null,
      error: "offline",
    };
    const lookup = spyOn(openRouterCatalog, "get").mockImplementation(
      async () => catalog,
    );
    const cachedLookup = spyOn(openRouterCatalog, "peek").mockImplementation(
      () => catalog,
    );
    const { url, close } = await startTestServer();
    const update = (path: string, method: string, body: unknown) =>
      fetch(`${url}/api/settings/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      let response = await fetch(`${url}/api/models`);
      let body = (await response.json()) as {
        models: { id: string; availability?: string }[];
      };
      expect(
        body.models.find((m) => m.id === "openrouter:openai/test")
          ?.availability,
      ).toBe("unverified");
      expect(
        (
          await update("openrouter/models", "PATCH", {
            route: "unknown/model",
            enabled: true,
          })
        ).status,
      ).toBe(503);
      lookup.mockClear();
      expect(
        (
          await update("openrouter/models", "PATCH", {
            route: model.route,
            enabled: false,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await update("models/favorite", "PUT", {
            provider: "openrouter",
            modelId: model.route,
            favorite: false,
          })
        ).status,
      ).toBe(200);
      expect(lookup).not.toHaveBeenCalled();
      setOpenRouterModelEnabled(model, true);
      setModelFavorite("openrouter", model.route, true);
      catalog = {
        status: "fresh",
        models: [],
        lastSuccessfulFetchAt: Date.now(),
        error: null,
      };
      response = await fetch(`${url}/api/models`);
      body = await response.json();
      expect(
        body.models.some((m) => m.id === "openrouter:openai/test"),
      ).toBeFalse();
      expect(listOpenRouterModels()[0]?.enabled).toBe(1);
      expect(listModelFavorites()).toHaveLength(1);
      catalog = {
        ...catalog,
        models: [{ ...model, route: "openai/test:batch" }],
      };
      expect(
        (
          await update("openrouter/models", "PATCH", {
            route: "openai/test:batch",
            enabled: true,
          })
        ).status,
      ).toBe(400);
    } finally {
      lookup.mockRestore();
      cachedLookup.mockRestore();
      await close();
    }
  });

  test("validates configuration and runs through the existing agent flow", async () => {
    const route = "openai/gpt-5.6-terra";
    const model = `openrouter:${route}`;
    const { url, close } = await startTestServer();
    try {
      setOpenRouterApiKey("");
      let response = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(runBody(model)),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "Configure an OpenRouter API key",
      );

      setOpenRouterApiKey("sk-or-run-test");
      response = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(runBody("openrouter:missing/model")),
      });
      expect(response.status).toBe(200);
      await response.text();

      response = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(runBody(model)),
      });
      expect(response.status).toBe(200);
      const stream = await response.text();
      expect(stream).toContain('"type":"run_delta"');
      expect(stream).toContain("Hello from OpenRouter.");
      expect(stream).toContain('"type":"run_done"');
      expect(getOpenRouterApiKey()).toBe("sk-or-run-test");
    } finally {
      await close();
    }
  });

  test("finishes and persists a run after its app connection closes", async () => {
    const model = "openrouter:openai/gpt-5.6-terra";
    const { url, close } = await startTestServer();
    try {
      setOpenRouterApiKey("sk-or-background-run-test");
      setOpenRouterScenario("delayed-stream");

      const created = await fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ model }),
      });
      expect(created.status).toBe(201);
      const { id: sessionId } = (await created.json()) as { id: string };

      const response = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          message: "Keep going in the background",
          history: [],
          model,
          sessionId,
        }),
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      await reader?.cancel();

      const deadline = Date.now() + 2_000;
      let history: Array<{
        role: string;
        content: string;
        steps?: Array<Record<string, unknown>>;
      }> = [];
      while (Date.now() < deadline) {
        const stored = await fetch(`${url}/api/sessions/${sessionId}`, {
          headers: userHeaders(),
        });
        history = ((await stored.json()) as { history: typeof history })
          .history;
        if (history.some((message) => message.role === "assistant")) break;
        await Bun.sleep(20);
      }

      expect(history).toEqual([
        { role: "user", content: "Keep going in the background" },
        {
          role: "assistant",
          content: "Hello after closing the app.",
          steps: expect.any(Array),
        },
      ]);
    } finally {
      await close();
    }
  });
});
