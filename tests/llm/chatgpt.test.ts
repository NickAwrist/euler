import { afterEach, expect, test } from "bun:test";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  chatGptHostId,
  readChatGptCredential,
  saveChatGptCredential,
} from "../../src/db/chatgpt";
import { DATA_ROOT } from "../../src/db/constants";
import {
  chatGptChunks,
  chatGptInput,
  streamChatGptChat,
} from "../../src/llm/chatGptProvider";
import { resolveModelSelection } from "../../src/llm/modelSelection";
import type { LlmStreamChunk } from "../../src/llm/types";
import {
  chatGptAccessToken,
  chatGptStatus,
  disconnectChatGpt,
  finishChatGptLogin,
  startChatGptLogin,
} from "../../src/models/chatgpt";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const originalFetch = globalThis.fetch;
function mockFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  });
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const uuid of [owner, other])
    rmSync(join(DATA_ROOT, "chatgpt", `${uuid}.json`), { force: true });
});
const credential = () => ({
  clientId: "oaiapp_test",
  subject: "account-a",
  email: "a@example.com",
  name: "Account A",
  picture: "https://images.example.com/account-a.png",
  accessToken: "private-access",
  refreshToken: "private-refresh",
  idToken: "private-identity",
  scopes: ["chatgpt.tokens.use.direct"],
  expiresAt: Date.now() + 3600000,
});
async function collect(response: Response) {
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of chatGptChunks(response)) chunks.push(chunk);
  return chunks;
}
const sse = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  );

test("ChatGPT credentials are protected, scoped to a UUID, and status never exposes tokens", async () => {
  saveChatGptCredential(owner, credential());
  expect(chatGptStatus(owner)).toEqual({
    connected: true,
    email: "a@example.com",
    name: "Account A",
    picture: "https://images.example.com/account-a.png",
    planEnabled: true,
  });
  expect(chatGptStatus(other).connected).toBe(false);
  expect(() => readChatGptCredential("../escape")).toThrow();
  expect(
    statSync(join(DATA_ROOT, "chatgpt", `${owner}.json`)).mode & 0o777,
  ).toBe(0o600);
  expect(chatGptHostId()).toBe(chatGptHostId());
  await expect(chatGptAccessToken(other)).rejects.toThrow("Connect ChatGPT");
  expect(resolveModelSelection("chatgpt:gpt-example")).toEqual({
    provider: "chatgpt",
    model: "gpt-example",
  });
});

test("OAuth validates state, signed identity and nonce before activating a connection", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  let expectedNonce = "";
  let codeExchanges = 0;
  let profilePicture = "https://images.example.com/account-a.png";
  mockFetch(async (input, init) => {
    if (String(input).endsWith("jwks.json"))
      return Response.json({
        keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
      });
    codeExchanges++;
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("client_id")).toBe("oaiapp_test");
    expect(form.get("code_verifier")?.length).toBeGreaterThan(40);
    const id = await new SignJWT({
      nonce: expectedNonce,
      email: "a@example.com",
      name: "Account A",
      picture: profilePicture,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://auth.openai.com")
      .setAudience("oaiapp_test")
      .setSubject("account-a")
      .setExpirationTime("1h")
      .sign(privateKey);
    return Response.json({
      access_token: "access",
      refresh_token: "refresh",
      id_token: id,
      token_type: "Bearer",
      scope: "openid chatgpt.tokens.use.direct",
      expires_in: 3600,
    });
  });
  let authorize = new URL(startChatGptLogin(owner).authorizationUrl);
  expect(authorize.searchParams.get("client_id")).toBe("dynamic_agent_client");
  const callback = new URL("http://127.0.0.1:1455/auth/callback");
  callback.search = new URLSearchParams({
    code: "code",
    client_id: "oaiapp_test",
    state: authorize.searchParams.get("state") ?? "",
  }).toString();
  await expect(
    finishChatGptLogin(other, callback.toString()),
  ).rejects.toThrow();
  expect(codeExchanges).toBe(0);
  expectedNonce = "wrong-nonce";
  await expect(finishChatGptLogin(owner, callback.toString())).rejects.toThrow(
    "validation failed",
  );
  expect(chatGptStatus(owner).connected).toBe(false);
  authorize = new URL(startChatGptLogin(owner).authorizationUrl);
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  expectedNonce = authorize.searchParams.get("nonce") ?? "";
  expect(
    (await finishChatGptLogin(owner, callback.toString())).planEnabled,
  ).toBe(true);
  expect(chatGptStatus(owner)).toMatchObject({
    name: "Account A",
    picture: "https://images.example.com/account-a.png",
  });
  expect(JSON.stringify(chatGptStatus(owner))).not.toContain("accessToken");
  expect(chatGptStatus(other)).toMatchObject({ name: null, picture: null });
  await expect(
    finishChatGptLogin(owner, callback.toString()),
  ).rejects.toThrow();
  expect(
    new URL(startChatGptLogin(owner).authorizationUrl).searchParams.get(
      "client_id",
    ),
  ).toBe("oaiapp_test");
  profilePicture = "not-a-url";
  authorize = new URL(startChatGptLogin(owner).authorizationUrl);
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  expectedNonce = authorize.searchParams.get("nonce") ?? "";
  expect(await finishChatGptLogin(owner, callback.toString())).toMatchObject({
    connected: true,
    name: "Account A",
    picture: null,
  });
});

test("refresh is serialized and cannot restore a disconnected connection", async () => {
  saveChatGptCredential(owner, { ...credential(), expiresAt: 0 });
  let resolveResponse: ((response: Response) => void) | undefined;
  let refreshCount = 0;
  mockFetch(async (input) => {
    if (String(input).endsWith("revoke"))
      return new Response(null, { status: 200 });
    refreshCount++;
    return new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  });
  const first = chatGptAccessToken(owner);
  const second = chatGptAccessToken(owner);
  const result = Promise.allSettled([first, second]);
  expect(refreshCount).toBe(1);
  await disconnectChatGpt(owner);
  resolveResponse?.(
    Response.json({
      access_token: "new-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
  );
  expect((await result).every((item) => item.status === "rejected")).toBe(true);
  expect(readChatGptCredential(owner)).toBe(null);
});

test("Responses streams require completion, retain tool IDs and propagate midstream failures", async () => {
  const chunks = await collect(
    sse([
      {
        type: "response.created",
        response: { error: null, usage: null },
      },
      {
        type: "response.in_progress",
        response: { error: null, usage: null },
      },
      { type: "response.output_text.delta", delta: "Hello" },
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call-1",
          name: "read",
          arguments: '{"path":"x"}',
        },
      },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 12, output_tokens: 3 } },
      },
    ]),
  );
  expect(chunks[0]?.contentDelta).toBe("Hello");
  expect(chunks.at(-1)?.toolCalls?.[0]?.id).toBe("call-1");
  expect(chunks.at(-1)?.metrics?.promptTokens).toBe(12);
  expect(
    await collect(
      sse([{ type: "response.completed", response: { usage: null } }]),
    ),
  ).toEqual([{ done: true }]);
  await expect(
    collect(sse([{ type: "response.output_text.delta", delta: "partial" }])),
  ).rejects.toThrow("before completion");
  await expect(
    collect(
      sse([
        {
          type: "response.failed",
          response: {
            error: { code: "subscription_sharing_usage_limit_exceeded" },
            usage: null,
          },
        },
      ]),
    ),
  ).rejects.toThrow("subscription_sharing_usage_limit_exceeded");
  expect(
    chatGptInput([{ role: "tool", content: "output", tool_call_id: "call-1" }]),
  ).toEqual([
    { type: "function_call_output", call_id: "call-1", output: "output" },
  ]);
});

test("inference uses only the selected user's OAuth credential and disables storage", async () => {
  saveChatGptCredential(owner, credential());
  mockFetch(async (_input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer private-access",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      store: false,
      stream: true,
      model: "gpt-example",
    });
    return sse([{ type: "response.completed" }]);
  });
  const stream = await streamChatGptChat({
    ownerUuid: owner,
    model: "gpt-example",
    messages: [],
    tools: [],
  });
  for await (const _chunk of stream) {
    /* consume */
  }
  await expect(
    streamChatGptChat({
      ownerUuid: other,
      model: "gpt-example",
      messages: [],
      tools: [],
    }),
  ).rejects.toThrow();
});

test("encrypted reasoning survives the stateless tool loop", async () => {
  const item = {
    type: "reasoning",
    id: "rs-1",
    summary: [],
    encrypted_content: "opaque-reasoning",
  };
  const chunks = await collect(
    sse([
      { type: "response.output_item.done", item },
      { type: "response.completed" },
    ]),
  );
  expect(chunks[0]?.reasoningDetails).toEqual([item]);
  const input = chatGptInput([
    {
      role: "assistant",
      content: "",
      reasoning_details: chunks[0]?.reasoningDetails,
      tool_calls: [
        { id: "call-1", function: { name: "read", arguments: "{}" } },
      ],
    },
  ]);
  expect(input[0]).toEqual(item);
  expect(input[1]?.type).toBe("function_call");
});

test("disconnect clears tokens but retains the account registration for later sign-in", async () => {
  saveChatGptCredential(owner, credential());
  mockFetch(async () => new Response(null, { status: 200 }));
  expect(await disconnectChatGpt(owner)).toEqual({ revoked: true });
  expect(readChatGptCredential(owner)).toBe(null);
  expect(chatGptStatus(owner).connected).toBe(false);
  const authorize = new URL(startChatGptLogin(owner).authorizationUrl);
  expect(authorize.searchParams.get("client_id")).toBe("oaiapp_test");
  expect(authorize.searchParams.has("id_token_hint")).toBe(false);
  const fresh = new URL(startChatGptLogin(owner, true).authorizationUrl);
  expect(fresh.searchParams.get("client_id")).toBe("dynamic_agent_client");
  expect(fresh.searchParams.get("agent_name_hint")).toBe("Euler");
  expect(fresh.searchParams.has("id_token_hint")).toBe(false);
});
