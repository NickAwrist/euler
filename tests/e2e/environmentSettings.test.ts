import { afterEach, expect, test } from "bun:test";
import {
  getComfyUIHost,
  getOllamaHost,
  getOpenRouterApiKey,
  getSearXNGHost,
} from "../../src/db";
import { getDb } from "../../src/db/connection";
import { envConfig } from "../../src/env";
import { startTestServer } from "../helpers/server";

const original = { ...envConfig };
afterEach(() => Object.assign(envConfig, original));

const settings = [
  {
    env: "ollamaHost",
    key: "ollama_host",
    path: "/api/ollama/config",
    field: "host",
    get: getOllamaHost,
  },
  {
    env: "comfyuiHost",
    key: "comfyui_host",
    path: "/api/comfyui/config",
    field: "host",
    get: getComfyUIHost,
  },
  {
    env: "searxngHost",
    key: "searxng_host",
    path: "/api/searxng/config",
    field: "host",
    get: getSearXNGHost,
  },
  {
    env: "openrouterApiKey",
    key: "openrouter_api_key",
    path: "/api/settings/openrouter",
    field: "apiKey",
    get: getOpenRouterApiKey,
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
    const { url, close } = await startTestServer();
    const put = (value: string) =>
      fetch(url + setting.path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [setting.field]: value }),
      });
    try {
      expect(setting.get()).toBe("http://environment.test");
      const read = await fetch(url + setting.path);
      const data = await read.json();
      if (setting.field === "apiKey") {
        expect(data).toEqual({ hasKey: true, environmentManaged: true });
        expect(JSON.stringify(data)).not.toContain(envConfig[setting.env]);
      } else {
        expect(data.host).toBe(envConfig[setting.env]);
      }
      for (const value of ["", "http://replacement.test"]) {
        const rejected = await put(value);
        expect(rejected.status).toBe(409);
        expect((await rejected.json()).error.code).toBe("CONFLICT");
      }
      // Saving a form that includes an unchanged locked field is a no-op.
      expect((await put(" http://environment.test ")).status).toBe(200);
      expect(
        db
          .query("SELECT value FROM app_settings WHERE key = ?")
          .get(setting.key),
      ).toEqual({ value: "http://saved.test" });
      envConfig[setting.env] = "";
      expect(setting.get()).toBe("http://saved.test");
      expect((await put("http://replacement.test")).status).toBe(200);
      expect(setting.get()).toBe("http://replacement.test");
    } finally {
      await close();
    }
  });
}

test("environment ownership contains only flags and does not lock unrelated ComfyUI fields", async () => {
  envConfig.ollamaHost = "http://ollama.test";
  envConfig.comfyuiHost = "http://comfyui.test";
  envConfig.searxngHost = "http://searxng.test";
  const { url, close } = await startTestServer();
  try {
    const ownership = await fetch(`${url}/api/settings/environment`);
    expect(await ownership.json()).toEqual({
      ollamaHost: true,
      comfyuiHost: true,
      searxngHost: true,
    });
    const save = await fetch(`${url}/api/comfyui/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: envConfig.comfyuiHost,
        negativePrompt: "updated",
      }),
    });
    expect(save.status).toBe(200);
    expect((await save.json()).negativePrompt).toBe("updated");
    const rejected = await fetch(`${url}/api/comfyui/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "http://override.test",
        negativePrompt: "must not save",
      }),
    });
    expect(rejected.status).toBe(409);
    const read = await fetch(`${url}/api/comfyui/config`);
    expect((await read.json()).negativePrompt).toBe("updated");
  } finally {
    await close();
  }
});
