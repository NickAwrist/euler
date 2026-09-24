import "../setup";
import { describe, expect, test } from "bun:test";
import { startTestServer, userHeaders } from "../helpers/server";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("browser UUID ownership", () => {
  test("isolates chats while connections stay global", async () => {
    const { url, close } = await startTestServer();
    try {
      expect((await fetch(`${url}/api/sessions`)).status).toBe(400);

      const createSessionA = await fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: userHeaders(USER_A, { "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      const sessionA = (await createSessionA.json()) as { id: string };
      expect(createSessionA.status).toBe(201);

      const sessionsB = await fetch(`${url}/api/sessions`, {
        headers: userHeaders(USER_B),
      });
      expect(await sessionsB.json()).toEqual({ sessions: [] });
      expect(
        (
          await fetch(`${url}/api/sessions/${sessionA.id}`, {
            headers: userHeaders(USER_B),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await fetch(`${url}/api/sessions/${sessionA.id}`, {
            method: "DELETE",
            headers: userHeaders(USER_B),
          })
        ).status,
      ).toBe(404);

      const forbiddenRun = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(USER_B, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          sessionId: sessionA.id,
          message: "Hello",
          history: [],
          model: "llama3:latest",
        }),
      });
      expect(forbiddenRun.status).toBe(404);

      await fetch(`${url}/api/ollama/config`, {
        method: "PUT",
        headers: userHeaders(USER_A, { "Content-Type": "application/json" }),
        body: JSON.stringify({ host: "http://global-ollama.test" }),
      });
      const globalConfig = await fetch(`${url}/api/ollama/config`, {
        headers: userHeaders(USER_B),
      });
      expect(await globalConfig.json()).toMatchObject({
        host: "http://global-ollama.test",
      });
    } finally {
      await close();
    }
  });
});
