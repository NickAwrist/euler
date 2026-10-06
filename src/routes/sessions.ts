import crypto from "node:crypto";
import { type Request, type Response, Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { withoutImageData } from "../db/agents";
import {
  type SessionRow,
  appendSessionEvent,
  createSessionRow,
  deleteSessionRow,
  findWorkspaceUser,
  getMessagesForSession,
  getSessionById,
  listSessionSummaries,
  patchSessionRow,
} from "../db/index";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { isLoopbackRequest } from "../http/isLoopbackRequest";
import { stripReasoningFromModelMessages } from "../llm/reasoningDetails";
import { revealFileNative } from "../nativeFolderPicker";
import { sendError, sendValidationError } from "../observability/http";
import {
  CreateSessionBodySchema,
  PatchSessionBodySchema,
  RevealFileSchema,
} from "../schemas/sessions";
import {
  LinkWorkspaceSchema,
  SelectDirectorySchema,
} from "../schemas/workspace";
import {
  deleteSession,
  ephemeralExpiry,
  releaseWorkspace,
} from "../sessions/lifecycle";
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";
import { agentActions } from "./agentActions";
import { artifactRoutes } from "./artifacts";

/** The chat when it exists and is idle; otherwise responds with the error. */
function idleSession(
  req: Request<{ id: string }>,
  res: Response,
): SessionRow | null {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return null;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return null;
  }
  if (agentRuntime.busy(ownerUuid, row.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return null;
  }
  return row;
}

function presentWorkspace(row: SessionRow) {
  const workspaceId = row.linked_workspace_id;
  return workspaceService.presentation(
    row,
    workspaceId && findWorkspaceUser(row.owner_uuid, workspaceId, row.id),
  );
}

const router = Router();
router.use(agentActions());
router.use("/:id/workspace/artifacts", artifactRoutes());

router.post("/:id/workspace/select-directory", async (req, res) => {
  if (!idleSession(req, res)) return;
  const parsed = SelectDirectorySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(
      res,
      "INVALID_REQUEST",
      "Enter an absolute folder path on the server",
    );
    return;
  }
  const path = await workspaceService.canonicalDirectory(parsed.data.path);
  const row = idleSession(req, res);
  if (!row) return;
  patchSessionRow(row.owner_uuid, row.id, {
    workspace_kind: "local",
    session_directory: path,
    linked_workspace_id: null,
  });
  appendSessionEvent(
    row.owner_uuid,
    row.id,
    `Working directory changed to ${path}`,
  );
  await releaseWorkspace(row.owner_uuid, row.linked_workspace_id);
  res.json({
    workspace: {
      kind: "local",
      path,
      label: path.split(/[\\/]/).pop() || path,
    },
  });
});

router.post("/:id/workspace/use-sandbox", async (req, res) => {
  const row = idleSession(req, res);
  if (!row) return;
  await workspaceService.provisionRetained(row.owner_uuid, row.id);
  const current = getSessionById(row.owner_uuid, row.id);
  if (current?.workspace_kind === "local" || current?.linked_workspace_id) {
    patchSessionRow(row.owner_uuid, row.id, {
      workspace_kind: "sandbox",
      session_directory: null,
      linked_workspace_id: null,
    });
    appendSessionEvent(
      row.owner_uuid,
      row.id,
      "Returned to the private workspace",
    );
    await releaseWorkspace(row.owner_uuid, current.linked_workspace_id);
  }
  res.json({ workspace: { kind: "sandbox" } });
});

router.post("/:id/workspace/link", async (req, res) => {
  const row = idleSession(req, res);
  if (!row) return;
  const parsed = LinkWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const source = getSessionById(row.owner_uuid, parsed.data.sessionId);
  if (!source) {
    sendError(res, "NOT_FOUND", "Chat not found");
    return;
  }
  if (source.id === row.id) {
    sendError(res, "INVALID_REQUEST", "Choose another chat to link");
    return;
  }
  if (source.workspace_kind === "local") {
    sendError(
      res,
      "INVALID_REQUEST",
      `That chat works in ${source.session_directory}. Use /directory to choose the same folder.`,
    );
    return;
  }
  // Join the source's current sandbox so links never form chains.
  const workspaceId = source.linked_workspace_id ?? source.id;
  const linked = workspaceId === row.id ? null : workspaceId;
  const patch = {
    workspace_kind: "sandbox",
    session_directory: null,
    linked_workspace_id: linked,
  } as const;
  if (row.workspace_kind !== "sandbox" || row.linked_workspace_id !== linked) {
    // No await separates reading the source from recording the link.
    patchSessionRow(row.owner_uuid, row.id, patch);
    appendSessionEvent(
      row.owner_uuid,
      row.id,
      linked
        ? "Linked to another chat's workspace"
        : "Returned to the private workspace",
    );
    await releaseWorkspace(row.owner_uuid, row.linked_workspace_id);
  }
  res.json({ workspace: presentWorkspace({ ...row, ...patch }) });
});

router.get("/:id/workspace/files", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  const workspace = await workspaceService.resolveSession(row);
  const files = await workspaceService.listFiles(workspace);
  res.json({ files: files.slice(0, 200) });
});

router.get("/:id/workspace/file", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  if (row.workspace_kind !== "sandbox") {
    sendError(
      res,
      "FORBIDDEN",
      "Local files cannot be downloaded through this route",
    );
    return;
  }
  const requestedPath =
    typeof req.query.path === "string" ? req.query.path : "";
  const workspace = await workspaceService.resolveSession(row);
  await downloadWorkspaceFile(res, workspace, requestedPath);
});

router.post("/:id/workspace/reveal", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (!isLoopbackRequest(req)) {
    sendError(
      res,
      "FORBIDDEN",
      "Files can only be revealed on the machine running Euler",
    );
    return;
  }
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  if (row.workspace_kind !== "local") {
    sendError(res, "FORBIDDEN", "Only local workspace files can be revealed");
    return;
  }
  const parsed = RevealFileSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const requestedPath = parsed.data.path;
  const workspace = await workspaceService.resolveSession(row);
  const path = await workspaceService.resolveExistingPath(
    workspace,
    requestedPath,
  );
  await revealFileNative(path);
  res.json({ ok: true });
});

router.get("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const rows = listSessionSummaries(ownerUuid);
  const working = agentRuntime.store.sessionsWithStatus(ownerUuid, [
    "queued",
    "running",
  ]);
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      customTitle: r.title,
      preview: r.preview,
      badge: working.has(r.id) ? "working" : r.unread ? "unread" : null,
      expiresAt: r.expires_at,
    })),
  });
});

router.get("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const id = req.params.id;
  const row = getSessionById(ownerUuid, id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  const history = getMessagesForSession(ownerUuid, id);
  res.json({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customTitle: row.title,
    history,
    modelMessages: stripReasoningFromModelMessages(
      agentRuntime.main(ownerUuid, id).history.map(withoutImageData),
    ),
    model: row.model,
    workspace: presentWorkspace(row),
    expiresAt: row.expires_at,
  });
});

router.post("/", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = CreateSessionBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const model = parsed.data.model?.trim() || null;
  const expiresAt = parsed.data.ephemeral ? ephemeralExpiry(now) : null;
  createSessionRow(ownerUuid, id, now, model, expiresAt);
  try {
    await workspaceService.provisionRetained(ownerUuid, id);
  } catch (error) {
    deleteSessionRow(ownerUuid, id);
    throw error;
  }
  agentRuntime.main(ownerUuid, id);
  res.status(201).json({ id, createdAt: now, updatedAt: now, expiresAt });
});

router.patch("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const id = req.params.id;
  const row = getSessionById(ownerUuid, id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  const parsed = PatchSessionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data;
  const now = Date.now();

  const patch: Parameters<typeof patchSessionRow>[2] = { updated_at: now };
  if ("customTitle" in body) {
    const t = body.customTitle;
    patch.title =
      t === null || t === undefined
        ? null
        : typeof t === "string"
          ? t.trim() || null
          : null;
  }
  if (body.model !== undefined) patch.model = body.model?.trim() || null;
  patchSessionRow(ownerUuid, id, patch);
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  const ok = await deleteSession(row);
  if (!ok) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  res.json({ ok: true });
});

export default router;
