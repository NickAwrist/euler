import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema } from "../../src/db/schema";
import { startTestServer } from "../helpers/server";

test("ChatGPT routes require a UUID and keep pending sign-ins separate", async () => {
  const { url, close } = await startTestServer();
  const headers = { "x-euler-user-id": "33333333-3333-4333-8333-333333333333" };
  try {
    expect((await fetch(`${url}/api/settings/chatgpt`)).status).toBe(400);
    const status = await fetch(`${url}/api/settings/chatgpt`, { headers });
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    expect(await status.json()).toEqual({
      connected: false,
      email: null,
      name: null,
      picture: null,
      planEnabled: false,
    });
    const login = await fetch(`${url}/api/settings/chatgpt/login`, {
      headers,
      method: "POST",
    });
    const body = (await login.json()) as { authorizationUrl: string };
    expect(new URL(body.authorizationUrl).hostname).toBe("auth.openai.com");
    expect(body).not.toHaveProperty("code_verifier");
    const invalid = await fetch(`${url}/api/settings/chatgpt/callback`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        callbackUrl: "http://127.0.0.1:1455/auth/callback?code=a&state=wrong",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(
      (await (await fetch(`${url}/api/settings/chatgpt`, { headers })).json())
        .connected,
    ).toBe(false);
  } finally {
    await close();
  }
});

test("favorites migration preserves saved selections and allows ChatGPT", () => {
  const db = new Database(":memory:");
  try {
    db.run(`CREATE TABLE model_favorites (owner_uuid TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('openrouter', 'ollama')), model_id TEXT NOT NULL, PRIMARY KEY (owner_uuid, provider, model_id));
      INSERT INTO model_favorites VALUES ('owner', 'ollama', 'local');`);
    createSchema(db);
    db.run(
      "INSERT INTO model_favorites VALUES ('owner', 'chatgpt', 'gpt-example')",
    );
    createSchema(db);
    expect(
      db
        .query(
          "SELECT provider, model_id FROM model_favorites ORDER BY provider",
        )
        .all(),
    ).toEqual([
      { provider: "chatgpt", model_id: "gpt-example" },
      { provider: "ollama", model_id: "local" },
    ]);
  } finally {
    db.close();
  }
});

test("sending with a disconnected ChatGPT model fails before starting a run", async () => {
  const { url, close } = await startTestServer();
  const headers = {
    "x-euler-user-id": "33333333-3333-4333-8333-333333333333",
    "Content-Type": "application/json",
  };
  try {
    const created = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };
    const sent = await fetch(`${url}/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "Hello", model: "chatgpt:gpt-example" }),
    });
    expect(sent.status).toBe(400);
    expect(await sent.json()).toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        message: "Connect ChatGPT in Settings before using this model",
      },
    });
  } finally {
    await close();
  }
});
