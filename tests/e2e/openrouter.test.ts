import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { waitForActivation } from "../helpers/activation";
import { TEST_USER_ID } from "../helpers/server";
import "../setup";
import { describe, expect, spyOn, test } from "bun:test";
import {
  createSessionRow,
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
  InputCapability,
  ModelProvider,
  Model_Availability,
} from "../../src/gen/euler/v1/models_pb";
import { ApiKeyProvider } from "../../src/gen/euler/v1/providers_pb";
import { Message_Role } from "../../src/gen/euler/v1/sessions_pb";
import {
  type CatalogResult,
  normalizeCatalog,
  openRouterCatalog,
} from "../../src/models/openRouterModels";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";

describe("OpenRouter API integration", () => {
  test("exposes a provider-aware model catalog even when one provider fails", async () => {
    setOllamaHost("http://ollama.test");
    setOpenRouterApiKey("");
    const { models, providers } = rpc();
    let listed = await models.listModels({});
    expect(
      listed.models.find((model) => model.provider === ModelProvider.OLLAMA),
    ).toMatchObject({
      inputCapabilities: [InputCapability.TEXT, InputCapability.IMAGE],
      supportsTools: true,
    });
    expect(
      listed.models.some(
        (model) => model.provider === ModelProvider.OPENROUTER,
      ),
    ).toBeFalse();

    await providers.setApiKey({
      provider: ApiKeyProvider.OPENROUTER,
      apiKey: "sk-or-api-test",
    });
    await providers.getOpenRouterCatalog({});
    await providers.setOpenRouterModelEnabled({
      route: "openai/gpt-5.6-terra",
      enabled: true,
    });
    listed = await models.listModels({});
    expect(
      listed.models
        .filter((model) => model.provider === ModelProvider.OPENROUTER)
        .every((model) => model.configured),
    ).toBeTrue();
    expect(
      listed.models.find(
        (model) => model.id === "openrouter:openai/gpt-5.6-terra",
      )?.inputCapabilities,
    ).toEqual([InputCapability.TEXT, InputCapability.IMAGE]);
  });

  test("reads the cached catalog and refreshes only on request", async () => {
    const lookup = spyOn(openRouterCatalog, "get");
    const { providers } = rpc();
    try {
      await providers.getOpenRouterCatalog({});
      expect(lookup).toHaveBeenLastCalledWith(false);
      const refreshed = await providers.refreshOpenRouterCatalog({});
      expect(lookup).toHaveBeenLastCalledWith(true);
      expect(refreshed.catalog?.publishers.length).toBeGreaterThan(0);
    } finally {
      lookup.mockRestore();
    }
  });

  test("manages activation and independent favorites through settings", async () => {
    const { models, providers } = rpc();
    const route = "example/test-model";
    await providers.getOpenRouterCatalog({});
    await models.setFavorite({
      provider: ModelProvider.OPENROUTER,
      modelId: route,
      favorite: true,
    });
    expect(
      await rpcCode(
        models.setFavorite({
          provider: ModelProvider.OPENROUTER,
          modelId: `openrouter:${route}`,
          favorite: true,
        }),
      ),
    ).toBe(Code.InvalidArgument);
    expect(listOpenRouterModels()).toHaveLength(0);
    await providers.setOpenRouterModelEnabled({ route, enabled: false });
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
    await providers.setOpenRouterModelEnabled({ route, enabled: true });
    const catalog = await providers.getOpenRouterCatalog({});
    expect(catalog.catalog?.modelsByPublisher.example?.models).toMatchObject([
      { route, enabled: true, favorite: true },
    ]);
    expect(
      await rpcCode(
        providers.setOpenRouterModelEnabled({
          route: "unknown/model",
          enabled: true,
        }),
      ),
    ).toBe(Code.InvalidArgument);
    expect(
      await rpcCode(
        providers.trackOpenRouterPublisher({ publisherId: "invented" }),
      ),
    ).toBe(Code.InvalidArgument);
    await providers.removeOpenRouterPublisher({ publisherId: "example" });
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
    expect(
      listModelFavorites(TEST_USER_ID).some(
        (favorite) => favorite.model_id === route,
      ),
    ).toBeTrue();
    await providers.trackOpenRouterPublisher({ publisherId: "example" });
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
    expect(
      await rpcCode(
        providers.removeOpenRouterPublisher({ publisherId: "invented" }),
      ),
    ).toBe(Code.NotFound);
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
    setModelFavorite(TEST_USER_ID, "openrouter", model.route, true);
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
    const { models, providers } = rpc();
    try {
      let listed = await models.listModels({});
      expect(
        listed.models.find((m) => m.id === "openrouter:openai/test")
          ?.availability,
      ).toBe(Model_Availability.UNVERIFIED);
      expect(
        await rpcCode(
          providers.setOpenRouterModelEnabled({
            route: "unknown/model",
            enabled: true,
          }),
        ),
      ).toBe(Code.Unavailable);
      lookup.mockClear();
      await providers.setOpenRouterModelEnabled({
        route: model.route,
        enabled: false,
      });
      await models.setFavorite({
        provider: ModelProvider.OPENROUTER,
        modelId: model.route,
        favorite: false,
      });
      expect(lookup).not.toHaveBeenCalled();
      setOpenRouterModelEnabled(model, true);
      setModelFavorite(TEST_USER_ID, "openrouter", model.route, true);
      catalog = {
        status: "fresh",
        models: [],
        lastSuccessfulFetchAt: Date.now(),
        error: null,
      };
      listed = await models.listModels({});
      expect(
        listed.models.some((m) => m.id === "openrouter:openai/test"),
      ).toBeFalse();
      expect(listOpenRouterModels()[0]?.enabled).toBe(1);
      expect(listModelFavorites(TEST_USER_ID)).toHaveLength(1);
      catalog = {
        ...catalog,
        models: [{ ...model, route: "openai/test:batch" }],
      };
      expect(
        await rpcCode(
          providers.setOpenRouterModelEnabled({
            route: "openai/test:batch",
            enabled: true,
          }),
        ),
      ).toBe(Code.InvalidArgument);
    } finally {
      lookup.mockRestore();
      cachedLookup.mockRestore();
    }
  });

  test("validates model configuration before enqueueing a turn", async () => {
    const id = crypto.randomUUID();
    createSessionRow(TEST_USER_ID, id, Date.now(), null);
    const { agent } = rpc();
    const send = (model: string) =>
      agent.sendMessage({
        sessionId: id,
        content: "Hello",
        settings: { model },
      });
    try {
      setOpenRouterApiKey("");
      expect(await rpcCode(send("openrouter:openai/gpt-5.6-terra"))).toBe(
        Code.InvalidArgument,
      );
      setOpenRouterApiKey("sk-or-run-test");
      await send("openrouter:openai/gpt-5.6-terra");
      const state = await waitForActivation(id);
      expect(state.history?.at(-1)?.content).toBe("Hello from OpenRouter.");
      expect(getOpenRouterApiKey()).toBe("sk-or-run-test");
    } finally {
      await agentRuntime.deleteSession(TEST_USER_ID, id);
    }
  });

  test("finishes and persists a run after its client goes away", async () => {
    const model = "openrouter:openai/gpt-5.6-terra";
    setOpenRouterApiKey("sk-or-background-run-test");
    setOpenRouterScenario("delayed-stream");
    const { sessions, agent, events } = rpc();
    const { id: sessionId } = await sessions.createSession({ model });
    // A client watching the stream disconnects right after sending.
    const controller = new AbortController();
    const stream = events.subscribe(
      { afterSequence: 0n },
      { signal: controller.signal },
    );
    await stream[Symbol.asyncIterator]().next();
    await agent.sendMessage({
      sessionId,
      content: "Keep going in the background",
      settings: { model },
    });
    controller.abort();

    const deadline = Date.now() + 2_000;
    let history = (await sessions.getSession({ id: sessionId })).session
      ?.history;
    while (Date.now() < deadline) {
      history = (await sessions.getSession({ id: sessionId })).session?.history;
      if (history?.some((message) => message.role === Message_Role.ASSISTANT))
        break;
      await Bun.sleep(20);
    }
    expect(history).toMatchObject([
      { role: Message_Role.USER, content: "Keep going in the background" },
      {
        role: Message_Role.ASSISTANT,
        content: "Hello after closing the app.",
        steps: expect.any(Array),
      },
    ]);
  });
});
