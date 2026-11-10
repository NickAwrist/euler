import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import "../setup";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { getSessionById, patchSessionRow } from "../../src/db";
import { Message_Role } from "../../src/gen/euler/v1/sessions_pb";
import { WorkspaceService } from "../../src/gen/euler/v1/workspace_pb";
import { isLoopbackRequest } from "../../src/http/isLoopbackRequest";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

const temporaryDirectories: string[] = [];
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const api = rpc();
const createSession = async () => (await api.sessions.createSession({})).id;

async function download(sessionId: string, path: string) {
  const chunks: Uint8Array[] = [];
  for await (const { part } of api.workspace.downloadFile({ sessionId, path }))
    if (part.case === "chunk") chunks.push(part.value);
  return Buffer.concat(chunks).toString();
}

describe("workspace API", () => {
  test("file search includes matches beyond the default result cap", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "orbis-file-search-"));
    temporaryDirectories.push(directory);
    const id = await createSession();
    patchSessionRow(TEST_USER_ID, id, {
      workspace_kind: "local",
      session_directory: directory,
    });
    await fs.writeFile(join(directory, "OldTarget.ts"), "target");
    await fs.utimes(join(directory, "OldTarget.ts"), 1, 1);
    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        fs.writeFile(join(directory, `${index}.txt`), "newer"),
      ),
    );
    const initial = await api.workspace.listFiles({ sessionId: id });
    expect(initial.files).toHaveLength(200);
    expect(
      initial.files.some((file) => file.path === "OldTarget.ts"),
    ).toBeFalse();
    const filtered = await api.workspace.listFiles({
      sessionId: id,
      query: "oldtarget",
    });
    expect(filtered.files).toMatchObject([{ path: "OldTarget.ts" }]);
    expect(
      (await api.workspace.listFiles({ sessionId: id, query: "missing" }))
        .files,
    ).toEqual([]);
    expect(
      await rpcCode(
        rpc(OTHER_USER).workspace.listFiles({
          sessionId: id,
          query: "oldtarget",
        }),
      ),
    ).toBe(Code.NotFound);
  });

  test("selects and switches server directories remotely", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "orbis-directory-test-"));
    temporaryDirectories.push(directory);
    const secondDirectory = join(directory, "second");
    await fs.mkdir(secondDirectory);
    await fs.writeFile(join(directory, "file.txt"), "file");
    const id = await createSession();
    const select = (path: string, owner = TEST_USER_ID) =>
      rpc(owner).workspace.selectDirectory({ sessionId: id, path });
    for (const path of [
      "",
      "relative/path",
      join(directory, "missing"),
      join(directory, "file.txt"),
    ])
      expect(await rpcCode(select(path))).toBe(Code.InvalidArgument);
    expect(await rpcCode(select(directory, OTHER_USER))).toBe(Code.NotFound);
    for (const path of [directory, secondDirectory]) {
      const { workspace } = await select(path);
      expect(workspace?.kind).toMatchObject({
        case: "local",
        value: { path: await fs.realpath(path) },
      });
    }
    const active = spyOn(agentRuntime, "busy").mockReturnValue(true);
    try {
      expect(await rpcCode(select(directory))).toBe(Code.FailedPrecondition);
    } finally {
      active.mockRestore();
    }
    expect(
      workspaceService.presentation(getSessionById(TEST_USER_ID, id)!),
    ).toMatchObject({
      kind: "local",
      path: await fs.realpath(secondDirectory),
    });
    const returned = await api.workspace.useSandbox({ sessionId: id });
    expect(returned.workspace?.kind.case).toBe("sandbox");
  });

  test("returning to the private workspace records only actual transitions", async () => {
    const sessionId = await createSession();
    const returnToSandbox = () => api.workspace.useSandbox({ sessionId });
    const history = async () =>
      (await api.sessions.getSession({ id: sessionId })).session?.history;
    await returnToSandbox();
    expect(await history()).toEqual([]);

    patchSessionRow(TEST_USER_ID, sessionId, {
      workspace_kind: "local",
      session_directory: tmpdir(),
    });
    await Promise.all([returnToSandbox(), returnToSandbox()]);
    await returnToSandbox();
    expect(await history()).toMatchObject([
      {
        role: Message_Role.EVENT,
        content: "Returned to the private workspace",
      },
    ]);
    expect(getSessionById(TEST_USER_ID, sessionId)?.workspace_kind).toBe(
      "sandbox",
    );
  });

  test("creates a private server-owned workspace and ignores path patches", async () => {
    const sessionId = await createSession();
    const row = getSessionById(TEST_USER_ID, sessionId);
    expect(row).not.toBeNull();
    const workspace = await workspaceService.resolveSession(row!);
    expect(workspace.kind).toBe("sandbox");
    expect(workspace.hostPath).toContain(
      `/workspaces/${TEST_USER_ID}/${sessionId}`,
    );
    // UpdateSession has no workspace fields; unknown JSON fields change nothing.
    const { url, close } = await startTestServer();
    try {
      const patch = await fetch(
        `${url}/api/rpc/euler.v1.SessionService/UpdateSession`,
        {
          method: "POST",
          headers: userHeaders(undefined, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            id: sessionId,
            sessionDirectory: "/tmp",
            workspaceKind: "local",
          }),
        },
      );
      expect(patch.status).toBe(200);
    } finally {
      await close();
    }
    const { session } = await api.sessions.getSession({ id: sessionId });
    expect(session?.workspace?.kind.case).toBe("sandbox");
  });

  test("deleting a local-workspace chat leaves the directory untouched", async () => {
    const localDirectory = await fs.mkdtemp(
      join(tmpdir(), "orbis-local-delete-test-"),
    );
    temporaryDirectories.push(localDirectory);
    const localFile = join(localDirectory, "keep.txt");
    await fs.writeFile(localFile, "keep");
    const sessionId = await createSession();
    patchSessionRow(TEST_USER_ID, sessionId, {
      workspace_kind: "local",
      session_directory: localDirectory,
    });
    await api.sessions.deleteSession({ id: sessionId });
    expect(await fs.readFile(localFile, "utf8")).toBe("keep");
  });

  test("a linked sandbox survives until the last chat using it is gone", async () => {
    const link = (id: string, sourceSessionId: string) =>
      api.workspace.linkWorkspace({ sessionId: id, sourceSessionId });
    const [a, b, c] = [
      await createSession(),
      await createSession(),
      await createSession(),
    ];
    const original = await workspaceService.resolveSession(
      getSessionById(TEST_USER_ID, a)!,
    );
    const file = join(original.hostPath, "notes.txt");
    await fs.writeFile(file, "linked");

    expect(await rpcCode(link(a, a))).toBe(Code.InvalidArgument);
    const linked = await link(b, a);
    expect(linked.workspace?.kind).toMatchObject({
      case: "sandbox",
      value: { linked: { workspaceId: a, sessionId: a } },
    });
    expect(
      (await workspaceService.resolveSession(getSessionById(TEST_USER_ID, b)!))
        .hostPath,
    ).toBe(original.hostPath);
    // Linking to B joins the sandbox B works in rather than chaining to B.
    await link(c, b);
    expect(getSessionById(TEST_USER_ID, c)?.linked_workspace_id).toBe(a);

    await api.sessions.deleteSession({ id: a });
    expect(await fs.readFile(file, "utf8")).toBe("linked");
    const { session } = await api.sessions.getSession({ id: b });
    // With A gone, B is shown as linked to C, which still uses the sandbox.
    expect(session?.workspace?.kind).toMatchObject({
      value: { linked: { workspaceId: a, sessionId: c } },
    });

    await api.workspace.useSandbox({ sessionId: b });
    expect(getSessionById(TEST_USER_ID, b)?.linked_workspace_id).toBeNull();
    expect(await fs.readFile(file, "utf8")).toBe("linked");

    // The last reference switching away releases the orphaned sandbox.
    const localDirectory = await fs.mkdtemp(
      join(tmpdir(), "orbis-link-release-test-"),
    );
    temporaryDirectories.push(localDirectory);
    await api.workspace.selectDirectory({ sessionId: c, path: localDirectory });
    expect(await fs.exists(original.hostPath)).toBeFalse();
  });

  test("deleting the last linked chat trashes the sandbox", async () => {
    const a = await createSession();
    const b = await createSession();
    const original = await workspaceService.resolveSession(
      getSessionById(TEST_USER_ID, a)!,
    );
    await api.workspace.linkWorkspace({ sessionId: b, sourceSessionId: a });
    for (const id of [a, b]) {
      await api.sessions.deleteSession({ id });
      expect(await fs.exists(original.hostPath)).toBe(id === a);
    }
  });

  test("linking refuses local chats and busy chats", async () => {
    const a = await createSession();
    const b = await createSession();
    const link = () =>
      api.workspace.linkWorkspace({ sessionId: b, sourceSessionId: a });
    const active = spyOn(agentRuntime, "busy").mockReturnValue(true);
    try {
      expect(await rpcCode(link())).toBe(Code.FailedPrecondition);
    } finally {
      active.mockRestore();
    }
    patchSessionRow(TEST_USER_ID, a, {
      workspace_kind: "local",
      session_directory: tmpdir(),
    });
    expect(await rpcCode(link())).toBe(Code.InvalidArgument);
    expect(getSessionById(TEST_USER_ID, b)?.linked_workspace_id).toBeNull();
  });

  for (const swap of ["file", "parent"] as const) {
    test(`download pins the ${swap} during replacement`, async () => {
      const outside = await fs.mkdtemp(join(tmpdir(), "orbis-download-race-"));
      temporaryDirectories.push(outside);
      await fs.writeFile(join(outside, "output.txt"), "outside secret");
      const id = await createSession();
      const workspace = await workspaceService.resolveSession(
        getSessionById(TEST_USER_ID, id)!,
      );
      const parent = join(workspace.hostPath, "parent");
      await fs.mkdir(parent);
      await fs.writeFile(join(parent, "output.txt"), "workspace output");
      const originalOpen = fs.open.bind(fs);
      let replaced = false;
      const open = spyOn(fs, "open").mockImplementation(
        async (path, flags, mode) => {
          const handle = await originalOpen(path, flags, mode);
          if (
            !replaced &&
            String(path).endsWith(swap === "parent" ? "/parent" : "/output.txt")
          ) {
            replaced = true;
            const target =
              swap === "parent" ? parent : join(parent, "output.txt");
            await fs.rename(target, `${target}.original`);
            await fs.symlink(
              swap === "parent" ? outside : join(outside, "output.txt"),
              target,
            );
          }
          return handle;
        },
      );
      try {
        expect(await download(id, "parent/output.txt")).toBe(
          "workspace output",
        );
        expect(replaced).toBeTrue();
        expect(await rpcCode(download(id, "parent/output.txt"))).toBe(
          Code.InvalidArgument,
        );
      } finally {
        open.mockRestore();
      }
    });
  }
});

describe("revealing files", () => {
  test("only callers on the server's machine pass, even through a proxy", () => {
    expect(isLoopbackRequest("127.0.0.1", undefined)).toBeTrue();
    expect(isLoopbackRequest("::1", undefined)).toBeTrue();
    expect(isLoopbackRequest("100.64.0.2", undefined)).toBeFalse();
    // The Vite proxy connects from loopback and appends its client last.
    expect(isLoopbackRequest("127.0.0.1", "127.0.0.1")).toBeTrue();
    expect(isLoopbackRequest("127.0.0.1", "100.64.0.2")).toBeFalse();
    // A spoofed first hop does not help a tailnet client.
    expect(isLoopbackRequest("127.0.0.1", "127.0.0.1, 100.64.0.2")).toBeFalse();
    expect(isLoopbackRequest("100.64.0.2", "127.0.0.1")).toBeFalse();
  });

  test("RevealFile refuses a request a proxy forwarded from another machine", async () => {
    const sessionId = await createSession();
    patchSessionRow(TEST_USER_ID, sessionId, {
      workspace_kind: "local",
      session_directory: tmpdir(),
    });
    const { url, close } = await startTestServer();
    const client = (forwardedFor?: string) =>
      createClient(
        WorkspaceService,
        createConnectTransport({
          baseUrl: `${url}/api/rpc`,
          httpVersion: "1.1",
          interceptors: [
            (next) => (request) => {
              request.header.set("x-euler-user-id", TEST_USER_ID);
              if (forwardedFor)
                request.header.set("x-forwarded-for", forwardedFor);
              return next(request);
            },
          ],
        }),
      );
    try {
      expect(
        await rpcCode(
          client("100.64.0.2").revealFile({ sessionId, path: "missing.txt" }),
        ),
      ).toBe(Code.PermissionDenied);
      // A local caller gets past the check to the path validation.
      expect(
        await rpcCode(client().revealFile({ sessionId, path: "missing.txt" })),
      ).toBe(Code.InvalidArgument);
    } finally {
      await close();
    }
  });
});
