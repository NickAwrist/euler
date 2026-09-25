import fs from "node:fs/promises";
import { join } from "node:path";
import "../setup";
import { expect, test } from "bun:test";
import { getSessionById, patchSessionRow } from "../../src/db";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";
for (const temporary of [false, true]) {
  test(`artifact API scopes ${temporary ? "temporary" : "saved"} files to their owner`, async () => {
    const { url, close } = await startTestServer();
    try {
      const response = await fetch(
        `${url}/api/${temporary ? "temporary-sessions" : "sessions"}`,
        {
          method: "POST",
          headers: userHeaders(undefined, {
            "Content-Type": "application/json",
          }),
          body: "{}",
        },
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      const workspace = temporary
        ? await workspaceService.resolveTemporary(TEST_USER_ID, id)
        : await workspaceService.resolveSession(
            getSessionById(TEST_USER_ID, id)!,
          );
      await workspaceService.writeFile(workspace, "notes.md", "# Notes");
      const base = `${url}/api/${temporary ? `temporary-sessions/${id}` : `sessions/${id}/workspace`}/artifacts`;
      const tree = await fetch(`${base}/tree`, { headers: userHeaders() });
      expect(tree.status).toBe(200);
      expect(await tree.json()).toMatchObject({
        entries: [{ name: "notes.md", kind: "file" }],
      });
      const preview = await fetch(`${base}/preview?path=notes.md`, {
        headers: userHeaders(),
      });
      expect(await preview.json()).toEqual({
        kind: "text",
        path: "notes.md",
        content: "# Notes",
      });
      expect(preview.headers.get("cache-control")).toBe("no-store");
      const file = await fetch(`${base}/download?path=notes.md`, {
        headers: userHeaders(),
      });
      expect(file.status).toBe(200);
      expect(file.headers.get("content-disposition")).toContain("attachment;");
      expect(await file.text()).toBe("# Notes");
      // Downloading preserves binary bytes and works in the selected local directory too.
      const binary = Buffer.from([0, 255, 128, 1]);
      await fs.writeFile(join(workspace.hostPath, "file.bin"), binary);
      if (temporary)
        await workspaceService.selectTemporaryDirectory(
          TEST_USER_ID,
          id,
          workspace.hostPath,
        );
      else
        patchSessionRow(TEST_USER_ID, id, {
          workspace_kind: "local",
          session_directory: workspace.hostPath,
        });
      const localFile = await fetch(`${base}/download?path=file.bin`, {
        headers: userHeaders(),
      });
      expect(localFile.status).toBe(200);
      expect(Buffer.from(await localFile.arrayBuffer())).toEqual(binary);
      for (const action of [
        "tree",
        "preview?path=notes.md",
        "download?path=notes.md",
      ]) {
        const denied = await fetch(`${base}/${action}`, {
          headers: userHeaders("22222222-2222-4222-8222-222222222222"),
        });
        expect(denied.ok).toBeFalse();
      }
      const traversal = await fetch(`${base}/preview?path=../outside`, {
        headers: userHeaders(),
      });
      expect(traversal.status).toBe(400);
      const missing = await fetch(`${base}/preview?path=docs/missing.md`, {
        headers: userHeaders(),
      });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({
        error: { message: "Path does not exist: docs/missing.md" },
      });
      const invalidDownload = await fetch(`${base}/download?path=../outside`, {
        headers: userHeaders(),
      });
      expect(invalidDownload.status).toBe(400);
    } finally {
      await close();
    }
  });
}
