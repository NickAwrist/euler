import "../setup";
import { describe, expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import {
  applyPublisherSubscriptions,
  listModelFavorites,
  listOpenRouterModels,
  listOpenRouterPublishers,
  refreshRegistryMetadata,
  removeOpenRouterPublisher,
  setModelFavorite,
  setOpenRouterModelEnabled,
  setPublisherSubscription,
  trackOpenRouterPublisher,
} from "../../src/db/openrouter";
import { createSchema } from "../../src/db/schema";
import {
  getOpenRouterApiKey,
  setOpenRouterApiKey,
} from "../../src/db/settings";
import { normalizeCatalog } from "../../src/models/openRouterModels";

const model = (route = "openai/test", created = 101) =>
  normalizeCatalog({
    data: [
      {
        id: route,
        name: "Test",
        created,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
        },
      },
    ],
  })[0]!;

describe("OpenRouter preferences", () => {
  test("fresh database has common publishers and no selections", () => {
    expect(listOpenRouterPublishers()).toHaveLength(9);
    expect(listOpenRouterModels()).toEqual([]);
  });
  test("subscription transitions preserve timestamps and never backfill existing additions", () => {
    setPublisherSubscription("openai", true, 100);
    setPublisherSubscription("openai", true, 200);
    expect(
      listOpenRouterPublishers().find((p) => p.id === "openai")?.subscribed_at,
    ).toBe(100);
    applyPublisherSubscriptions([model("openai/old", 100), model()]);
    expect(listOpenRouterModels().map((m) => m.route)).toEqual(["openai/test"]);
    setPublisherSubscription("openai", false, 250);
    expect(listOpenRouterModels()).toHaveLength(1);
    setPublisherSubscription("openai", true, 300);
    expect(
      listOpenRouterPublishers().find((p) => p.id === "openai")?.subscribed_at,
    ).toBe(300);
  });
  test("disabled choices survive repeated sync and metadata updates; batch is excluded", () => {
    setPublisherSubscription("openai", true, 100);
    setOpenRouterModelEnabled(model(), false);
    const additions = [model(), model("openai/new"), model("openai/new:batch")];
    applyPublisherSubscriptions(additions);
    applyPublisherSubscriptions(additions);
    refreshRegistryMetadata([{ ...model(), name: "Updated" }]);
    expect(listOpenRouterModels()).toHaveLength(2);
    expect(
      listOpenRouterModels().find((m) => m.route === "openai/test"),
    ).toMatchObject({ enabled: 0, name: "Updated" });
  });
  test("removing a publisher stops auto-enable and preserves opt-outs and favorites across startup", () => {
    setOpenRouterModelEnabled(model(), true);
    setModelFavorite(
      "11111111-1111-4111-8111-111111111111",
      "openrouter",
      "openai/test",
      true,
    );
    setPublisherSubscription("openai", true, 100);
    expect(removeOpenRouterPublisher("openai")).toBeTrue();
    applyPublisherSubscriptions([model("openai/new")]);
    expect(listOpenRouterModels()).toHaveLength(1);
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
    expect(
      listModelFavorites("11111111-1111-4111-8111-111111111111"),
    ).toHaveLength(1);
    createSchema(getDb());
    expect(
      listOpenRouterPublishers().some((p) => p.id === "openai"),
    ).toBeFalse();
    trackOpenRouterPublisher("openai");
    expect(
      listOpenRouterPublishers().find((p) => p.id === "openai")?.subscribed,
    ).toBe(0);
    expect(listOpenRouterModels()[0]?.enabled).toBe(0);
  });
  test("favorites persist independently of activation and execution provider", () => {
    setModelFavorite(
      "11111111-1111-4111-8111-111111111111",
      "openrouter",
      "openai/test",
      true,
    );
    setModelFavorite(
      "11111111-1111-4111-8111-111111111111",
      "ollama",
      "openai/test",
      true,
    );
    setModelFavorite(
      "11111111-1111-4111-8111-111111111111",
      "ollama",
      "openai/test",
      true,
    );
    expect(listOpenRouterModels()).toEqual([]);
    expect(
      listModelFavorites("11111111-1111-4111-8111-111111111111"),
    ).toHaveLength(2);
    setOpenRouterModelEnabled(model(), false);
    expect(
      listModelFavorites("11111111-1111-4111-8111-111111111111"),
    ).toHaveLength(2);
    setModelFavorite(
      "11111111-1111-4111-8111-111111111111",
      "openrouter",
      "openai/test",
      false,
    );
    expect(listModelFavorites("11111111-1111-4111-8111-111111111111")).toEqual([
      { provider: "ollama", model_id: "openai/test" },
    ]);
    createSchema(getDb());
    expect(
      listModelFavorites("11111111-1111-4111-8111-111111111111"),
    ).toHaveLength(1);
    setOpenRouterApiKey("secret");
    expect(getOpenRouterApiKey()).toBe("secret");
  });
});
