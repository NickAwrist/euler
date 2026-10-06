import "../setup";
import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { envConfig } from "../../src/env";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

test("ephemeral chats are regular sessions with an expiry and are hard-deleted", async () => {
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  const create = async (body: unknown) => {
    const response = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; expiresAt: number | null };
  };
  try {
    const before = Date.now();
    const ephemeral = await create({ ephemeral: true });
    const saved = await create({});
    const ttl = envConfig.ephemeralChatTtlHours * 60 * 60 * 1000;
    expect(ephemeral.expiresAt).toBeGreaterThanOrEqual(before + ttl);
    expect(ephemeral.expiresAt).toBeLessThanOrEqual(Date.now() + ttl);
    expect(saved.expiresAt).toBeNull();

    const listed = await fetch(`${url}/api/sessions`, { headers });
    const { sessions } = (await listed.json()) as {
      sessions: { id: string; expiresAt: number | null }[];
    };
    expect(sessions).toContainEqual(
      expect.objectContaining({
        id: ephemeral.id,
        expiresAt: ephemeral.expiresAt,
      }),
    );
    const stored = await fetch(`${url}/api/sessions/${ephemeral.id}`, {
      headers,
    });
    expect(await stored.json()).toMatchObject({
      expiresAt: ephemeral.expiresAt,
    });

    const workspace = workspaceService.retainedPath(TEST_USER_ID, ephemeral.id);
    await fs.writeFile(`${workspace}/output.txt`, "output");
    const trashed = await fs.readdir(workspaceService.trashRoot);
    const deleted = await fetch(`${url}/api/sessions/${ephemeral.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
    await expect(fs.access(workspace)).rejects.toThrow();
    expect(await fs.readdir(workspaceService.trashRoot)).toEqual(trashed);
    expect(
      (await fetch(`${url}/api/sessions/${ephemeral.id}`, { headers })).status,
    ).toBe(404);
  } finally {
    await close();
  }
});
