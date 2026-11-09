import fs from "node:fs/promises";
import { join } from "node:path";
import "../setup";
import { expect, test } from "bun:test";
import { getSessionById, patchSessionRow } from "../../src/db";
import { ArtifactEntry_Kind } from "../../src/gen/euler/v1/workspace_pb";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

/** Collects a DownloadFile stream into its info and bytes. */
async function download(
  api: ReturnType<typeof rpc>,
  sessionId: string,
  path: string,
) {
  let name = "";
  const chunks: Uint8Array[] = [];
  for await (const { part } of api.workspace.downloadFile({
    sessionId,
    path,
  })) {
    if (part.case === "info") name = part.value.name;
    if (part.case === "chunk") chunks.push(part.value);
  }
  return { name, bytes: Buffer.concat(chunks) };
}

test("artifact API scopes files to their owner", async () => {
  const api = rpc();
  const other = rpc("22222222-2222-4222-8222-222222222222");
  const { id } = await api.sessions.createSession({});
  const workspace = await workspaceService.resolveSession(
    getSessionById(TEST_USER_ID, id)!,
  );
  await workspaceService.writeFile(workspace, "notes.md", "# Notes");
  const tree = await api.workspace.listArtifacts({ sessionId: id, path: "." });
  expect(tree.entries).toMatchObject([
    { name: "notes.md", kind: ArtifactEntry_Kind.FILE },
  ]);
  const { preview } = await api.workspace.previewArtifact({
    sessionId: id,
    path: "notes.md",
  });
  expect(preview).toMatchObject({
    path: "notes.md",
    content: { case: "text", value: "# Notes" },
  });
  expect(await download(api, id, "notes.md")).toEqual({
    name: "notes.md",
    bytes: Buffer.from("# Notes"),
  });
  // Downloading preserves binary bytes and works in a local directory too.
  const binary = Buffer.from([0, 255, 128, 1]);
  await fs.writeFile(join(workspace.hostPath, "file.bin"), binary);
  patchSessionRow(TEST_USER_ID, id, {
    workspace_kind: "local",
    session_directory: workspace.hostPath,
  });
  expect((await download(api, id, "file.bin")).bytes).toEqual(binary);
  // Files larger than one chunk arrive whole and in order.
  const large = Buffer.alloc(200 * 1024, 7);
  large.writeUInt32BE(0xdeadbeef, large.length - 4);
  await fs.writeFile(join(workspace.hostPath, "large.bin"), large);
  expect((await download(api, id, "large.bin")).bytes).toEqual(large);

  for (const call of [
    other.workspace.listArtifacts({ sessionId: id, path: "." }),
    other.workspace.previewArtifact({ sessionId: id, path: "notes.md" }),
    download(other, id, "notes.md"),
  ])
    expect(await rpcCode(call)).toBe(Code.NotFound);
  expect(
    await rpcCode(
      api.workspace.previewArtifact({ sessionId: id, path: "../outside" }),
    ),
  ).toBe(Code.InvalidArgument);
  const missing = await rpcError(
    api.workspace.previewArtifact({ sessionId: id, path: "docs/missing.md" }),
  );
  expect(missing.code).toBe(Code.InvalidArgument);
  expect(missing.rawMessage).toBe("Path does not exist: docs/missing.md");
  expect(await rpcCode(download(api, id, "../outside"))).toBe(
    Code.InvalidArgument,
  );
});
