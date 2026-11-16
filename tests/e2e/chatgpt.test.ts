import { expect, test } from "bun:test";
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
