import "../setup";
import { describe, expect, test } from "bun:test";
import { Code, rpc, rpcCode } from "../helpers/rpc";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("browser UUID ownership", () => {
  test("isolates chats while connections stay global", async () => {
    const a = rpc(USER_A);
    const b = rpc(USER_B);
    expect(await rpcCode(rpc(null).sessions.listSessions({}))).toBe(
      Code.InvalidArgument,
    );
    expect(await rpcCode(rpc("not-a-uuid").sessions.listSessions({}))).toBe(
      Code.InvalidArgument,
    );

    const sessionA = await a.sessions.createSession({});
    expect((await b.sessions.listSessions({})).sessions).toEqual([]);
    expect(await rpcCode(b.sessions.getSession({ id: sessionA.id }))).toBe(
      Code.NotFound,
    );
    expect(await rpcCode(b.sessions.deleteSession({ id: sessionA.id }))).toBe(
      Code.NotFound,
    );
    expect(
      await rpcCode(
        b.agent.sendMessage({
          sessionId: sessionA.id,
          content: "Hello",
          settings: { model: "llama3:latest" },
        }),
      ),
    ).toBe(Code.NotFound);
    expect(await rpcCode(b.agent.getRuntime({ sessionId: sessionA.id }))).toBe(
      Code.NotFound,
    );

    await a.providers.updateOllamaConfig({ host: "http://global-ollama.test" });
    expect((await b.providers.getOllamaConfig({})).config).toMatchObject({
      host: "http://global-ollama.test",
    });
  });
});
