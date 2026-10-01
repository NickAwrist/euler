import { expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations";
import { setOllamaHost } from "../../src/db/settings";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../../src/db/userPreferences";
import { userPreferencesSchema } from "../../src/schemas/userPreferences";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

const other = "22222222-2222-4222-8222-222222222222";
test("preferences require identity, isolate users, preserve unrelated fields, and reject invalid writes", async () => {
  const { url, close } = await startTestServer();
  const request = (owner: string, method = "GET", body?: unknown) =>
    fetch(`${url}/api/settings/user`, {
      method,
      headers: userHeaders(owner, { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    expect((await fetch(`${url}/api/settings/user`)).status).toBe(400);
    expect(await (await request(TEST_USER_ID)).json()).toBeNull();
    const initial = {
      settings: { defaultModel: "model-a", name: "Nick" },
      appearance: { theme: "nord" },
      layout: { sidebarCollapsed: true },
    };
    expect((await request(TEST_USER_ID, "PUT", initial)).status).toBe(200);
    // A second device's stale local preferences never overwrite the existing user.
    await request(TEST_USER_ID, "PUT", { settings: { defaultModel: "stale" } });
    await request(TEST_USER_ID, "PATCH", {
      settings: { showDebugButton: true },
    });
    const saved = userPreferencesSchema.parse(
      await (await request(TEST_USER_ID)).json(),
    );
    expect(saved.settings).toMatchObject({
      defaultModel: "model-a",
      name: "Nick",
      showDebugButton: true,
    });
    expect(saved.appearance.theme).toBe("nord");
    expect(saved.layout.sidebarCollapsed).toBe(true);
    expect(await (await request(other)).json()).toBeNull();
    await request(other, "PATCH", { settings: { defaultModel: "model-b" } });
    expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
      "model-a",
    );
    expect(getUserPreferences(other)?.settings.defaultModel).toBe("model-b");
    for (const body of [
      { settings: { defaultModel: 123 } },
      { appearance: { theme: "invalid" } },
      { apiKey: "secret" },
      { image: { defaultWidth: -1 } },
    ]) {
      expect((await request(TEST_USER_ID, "PATCH", body)).status).toBe(400);
    }
    expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
      "model-a",
    );
  } finally {
    await close();
  }
});

test("startup migrations preserve saved preferences", () => {
  updateUserPreferences(TEST_USER_ID, {
    settings: { defaultModel: "persisted" },
  });
  // Re-running startup migrations must preserve saved preferences.
  const db = getDb();
  runMigrations(db);
  expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
    "persisted",
  );
});

test("image defaults and model favorites are scoped to the requesting user", async () => {
  setOllamaHost("http://ollama.test");
  const { url, close } = await startTestServer();
  try {
    for (const [owner, model] of [
      [TEST_USER_ID, "image-a"],
      [other, "image-b"],
    ]) {
      const res = await fetch(`${url}/api/comfyui/config`, {
        method: "PUT",
        headers: userHeaders(owner, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          defaultModel: model,
          defaultWidth: 512,
          defaultHeight: 768,
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).defaultModel).toBe(model);
    }
    const partial = await fetch(`${url}/api/comfyui/config`, {
      method: "PUT",
      headers: userHeaders(TEST_USER_ID, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ negativePrompt: "blurry" }),
    });
    expect(await partial.json()).toMatchObject({
      defaultModel: "image-a",
      defaultWidth: 512,
      defaultHeight: 768,
      negativePrompt: "blurry",
    });
    const favorite = await fetch(`${url}/api/settings/models/favorite`, {
      method: "PUT",
      headers: userHeaders(TEST_USER_ID, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        provider: "ollama",
        modelId: "llama3:latest",
        favorite: true,
      }),
    });
    expect(favorite.status).toBe(200);
    for (const [owner, expected] of [
      [TEST_USER_ID, true],
      [other, false],
    ] as const) {
      const response = await fetch(`${url}/api/models`, {
        headers: userHeaders(owner),
      });
      expect(
        (await response.json()).models.find(
          (model: { id: string }) => model.id === "llama3:latest",
        ).favorite,
      ).toBe(expected);
    }
  } finally {
    await close();
  }
});
