import { ensureUserData } from "../../src/db/users";
import "../setup";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import { migrateOpenRouterCatalog } from "../../src/db/migrations";
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
import {
  getOpenRouterApiKey,
  setOpenRouterApiKey,
} from "../../src/db/settings";
import { normalizeCatalog } from "../../src/openRouterModels";

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
  test("migration replaces legacy registry once and preserves unrelated data", () => {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO app_settings VALUES ('openrouter_api_key', 'secret'), ('openrouter_models_seeded_v3', '1'), ('other', 'keep');
      CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT);
      INSERT INTO sessions VALUES ('session', 'openrouter:openai/old');
      CREATE TABLE openrouter_models (id INTEGER PRIMARY KEY, route TEXT, name TEXT, ai_lab TEXT);
      INSERT INTO openrouter_models VALUES (1, 'openai/old', 'Old', 'OpenAI');`);
    migrateOpenRouterCatalog(db);
    expect(db.query("SELECT * FROM openrouter_models").all()).toEqual([]);
    expect(db.query("SELECT * FROM app_settings ORDER BY key").all()).toEqual([
      { key: "openrouter_api_key", value: "secret" },
      { key: "other", value: "keep" },
    ]);
    db.run(
      "INSERT INTO openrouter_models VALUES ('openai/new', 'openai', 'New', 0, 100)",
    );
    db.run("INSERT INTO model_favorites VALUES ('owner', 'ollama', 'local')");
    migrateOpenRouterCatalog(db);
    expect(db.query("SELECT enabled FROM openrouter_models").get()).toEqual({
      enabled: 0,
    });
    expect(db.query("SELECT * FROM model_favorites").all()).toHaveLength(1);
    expect(db.query("SELECT model FROM sessions").get()).toEqual({
      model: "openrouter:openai/old",
    });
    db.close();
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
    migrateOpenRouterCatalog(getDb());
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
    migrateOpenRouterCatalog(getDb());
    expect(
      listModelFavorites("11111111-1111-4111-8111-111111111111"),
    ).toHaveLength(1);
    setOpenRouterApiKey("secret");
    expect(getOpenRouterApiKey()).toBe("secret");
  });
});

for (const recordedOwner of [null, "11111111-1111-4111-8111-111111111111"]) {
  test(`legacy favorites migrate once to ${recordedOwner ? "the recorded owner" : "the first user"}`, () => {
    const db = getDb();
    db.run("DROP TABLE model_favorites");
    db.run(
      "CREATE TABLE model_favorites (provider TEXT NOT NULL, model_id TEXT NOT NULL, PRIMARY KEY (provider, model_id))",
    );
    db.run("INSERT INTO model_favorites VALUES ('ollama', 'local')");
    if (recordedOwner)
      db.run(
        "INSERT INTO app_settings (key, value) VALUES ('legacy_user_data_claimed_by', ?)",
        [recordedOwner],
      );
    migrateOpenRouterCatalog(db);
    const first = "22222222-2222-4222-8222-222222222222";
    ensureUserData(first);
    expect(listModelFavorites(recordedOwner ?? first)).toEqual([
      { provider: "ollama", model_id: "local" },
    ]);
    ensureUserData("33333333-3333-4333-8333-333333333333");
    expect(listModelFavorites("33333333-3333-4333-8333-333333333333")).toEqual(
      [],
    );
    expect(
      db
        .query(
          "SELECT 1 FROM sqlite_master WHERE name = 'legacy_model_favorites'",
        )
        .get(),
    ).toBeNull();
    migrateOpenRouterCatalog(db);
    expect(listModelFavorites(recordedOwner ?? first)).toHaveLength(1);
  });
}
