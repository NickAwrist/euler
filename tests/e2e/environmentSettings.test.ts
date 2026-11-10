import { afterEach, expect, test } from "bun:test";
import {
  getBraveSearchApiKey,
  getComfyUIHost,
  getOllamaHost,
  getOpenRouterApiKey,
} from "../../src/db";
import { getDb } from "../../src/db/connection";
import { envConfig } from "../../src/env";
import { ApiKeyProvider } from "../../src/gen/euler/v1/providers_pb";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";

const original = { ...envConfig };
afterEach(() => Object.assign(envConfig, original));

const { providers, preferences } = rpc();
const apiKey = (provider: ApiKeyProvider) => ({
  read: async () => (await providers.getApiKey({ provider })).state,
  put: (value: string) => providers.setApiKey({ provider, apiKey: value }),
});
const settings = [
  {
    env: "ollamaHost",
    key: "ollama_host",
    get: getOllamaHost,
    read: async () => (await providers.getOllamaConfig({})).config,
    put: (host: string) => providers.updateOllamaConfig({ host }),
  },
  {
    env: "comfyuiHost",
    key: "comfyui_host",
    get: getComfyUIHost,
    read: async () => (await providers.getComfyUiConfig({})).config,
    put: (host: string) => providers.updateComfyUiConfig({ host }),
  },
  {
    env: "openrouterApiKey",
    key: "openrouter_api_key",
    get: getOpenRouterApiKey,
    ...apiKey(ApiKeyProvider.OPENROUTER),
  },
  {
    env: "braveSearchApiKey",
    key: "brave_search_api_key",
    get: getBraveSearchApiKey,
    ...apiKey(ApiKeyProvider.BRAVE),
  },
] as const;

for (const setting of settings) {
  test(`${setting.env} overrides storage, rejects changes, and becomes editable when unset`, async () => {
    const db = getDb();
    db.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [
      setting.key,
      "http://saved.test",
    ]);
    envConfig[setting.env] = "http://environment.test";
    expect(setting.get()).toBe("http://environment.test");
    const data = await setting.read();
    if (data && "hasKey" in data) {
      expect(data).toMatchObject({ hasKey: true, environmentManaged: true });
      expect(JSON.stringify(data)).not.toContain(envConfig[setting.env]);
    } else {
      expect(data?.host).toBe(envConfig[setting.env]);
    }
    for (const value of ["", "http://replacement.test"]) {
      const rejected = await rpcError(setting.put(value));
      expect(rejected.code).toBe(Code.FailedPrecondition);
      expect(rejected.rawMessage).toBe(
        "This setting is managed by the environment.",
      );
    }
    // Saving a form that includes an unchanged locked field is a no-op.
    await setting.put(" http://environment.test ");
    expect(
      db.query("SELECT value FROM app_settings WHERE key = ?").get(setting.key),
    ).toEqual({ value: "http://saved.test" });
    envConfig[setting.env] = "";
    expect(setting.get()).toBe("http://saved.test");
    await setting.put("http://replacement.test");
    expect(setting.get()).toBe("http://replacement.test");
  });
}

test("environment ownership contains only flags and does not lock unrelated ComfyUI fields", async () => {
  envConfig.ollamaHost = "http://ollama.test";
  envConfig.comfyuiHost = "http://comfyui.test";
  expect(await rpc(null).preferences.getEnvironment({})).toMatchObject({
    ollamaHost: true,
    comfyuiHost: true,
  });
  const saved = await providers.updateComfyUiConfig({
    host: envConfig.comfyuiHost,
    image: { negativePrompt: "updated" },
  });
  expect(saved.image?.negativePrompt).toBe("updated");
  expect(
    await rpcCode(
      providers.updateComfyUiConfig({
        host: "http://override.test",
        image: { negativePrompt: "must not save" },
      }),
    ),
  ).toBe(Code.FailedPrecondition);
  expect((await providers.getComfyUiConfig({})).image?.negativePrompt).toBe(
    "updated",
  );
  expect(
    (await preferences.getPreferences({})).preferences?.image,
  ).toMatchObject({ negativePrompt: "updated" });
});
