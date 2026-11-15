import "../setup";
import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { envConfig } from "../../src/env";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

test("ephemeral chats are regular sessions with an expiry and are hard-deleted", async () => {
  const { sessions } = rpc();
  const before = Date.now();
  const ephemeral = await sessions.createSession({ ephemeral: true });
  const saved = await sessions.createSession({});
  const ttl = envConfig.ephemeralChatTtlHours * 60 * 60 * 1000;
  const expiresAt = timestampMs(ephemeral.expiresAt!);
  expect(expiresAt).toBeGreaterThanOrEqual(before + ttl);
  expect(expiresAt).toBeLessThanOrEqual(Date.now() + ttl);
  expect(saved.expiresAt).toBeUndefined();

  const listed = await sessions.listSessions({});
  const summary = listed.sessions.find((s) => s.id === ephemeral.id);
  expect(summary?.expiresAt && timestampMs(summary.expiresAt)).toBe(expiresAt);
  const { session } = await sessions.getSession({ id: ephemeral.id });
  expect(session?.expiresAt && timestampMs(session.expiresAt)).toBe(expiresAt);

  // A chat gets its directory the first time a run works in it.
  const { hostPath: workspace } = await workspaceService.provisionRetained(
    TEST_USER_ID,
    ephemeral.id,
  );
  await fs.writeFile(`${workspace}/output.txt`, "output");
  const trashed = await fs.readdir(workspaceService.trashRoot);
  await sessions.deleteSession({ id: ephemeral.id });
  await expect(fs.access(workspace)).rejects.toThrow();
  expect(await fs.readdir(workspaceService.trashRoot)).toEqual(trashed);
  expect(await rpcCode(sessions.getSession({ id: ephemeral.id }))).toBe(
    Code.NotFound,
  );
});
