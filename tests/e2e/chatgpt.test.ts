import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema } from "../../src/db/schema";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";

const USER = "33333333-3333-4333-8333-333333333333";

test("ChatGPT RPCs require a UUID and keep pending sign-ins separate", async () => {
  const { providers } = rpc(USER);
  expect(await rpcCode(rpc(null).providers.getChatGptStatus({}))).toBe(
    Code.InvalidArgument,
  );
  const { status } = await providers.getChatGptStatus({});
  expect(status).toMatchObject({ connected: false, planEnabled: false });
  expect([status?.email, status?.name, status?.picture]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  const login = await providers.startChatGptLogin({});
  expect(new URL(login.authorizationUrl).hostname).toBe("auth.openai.com");
  expect(
    await rpcCode(
      providers.finishChatGptLogin({
        callbackUrl: "http://127.0.0.1:1455/auth/callback?code=a&state=wrong",
      }),
    ),
  ).toBe(Code.InvalidArgument);
  expect(
    await rpcCode(providers.finishChatGptLogin({ callbackUrl: "no" })),
  ).toBe(Code.InvalidArgument);
  expect((await providers.getChatGptStatus({})).status?.connected).toBe(false);
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
  const { sessions, agent } = rpc(USER);
  const { id } = await sessions.createSession({});
  const error = await rpcError(
    agent.sendMessage({
      sessionId: id,
      content: "Hello",
      settings: { model: "chatgpt:gpt-example" },
    }),
  );
  expect(error.code).toBe(Code.InvalidArgument);
  expect(error.rawMessage).toBe(
    "Connect ChatGPT in Settings before using this model",
  );
});
