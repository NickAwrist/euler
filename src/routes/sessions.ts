import crypto from "node:crypto";
import { Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { withoutImageData } from "../db/agents";
import {
  type SessionRow,
  appendSessionEvent,
  createSessionRow,
  deleteSessionRow,
  getMessagesForSession,
  getSessionById,
  getSessionLabel,
  isWorkspaceReferenced,
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
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";
import { agentActions } from "./agentActions";
import { artifactRoutes } from "./artifacts";

/** Trashes sandboxes that no remaining chat originates or links. */
async function releaseWorkspaces(
  ownerUuid: string,
  workspaceIds: Array<string | null>,
) {
  for (const id of new Set(workspaceIds)) {
    if (id && !isWorkspaceReferenced(ownerUuid, id))
      await workspaceService.trashRetained(ownerUuid, id);
  }
}

function presentWorkspace(row: SessionRow) {
  return workspaceService.presentation(
    row,
    row.linked_workspace_id &&
      getSessionLabel(row.owner_uuid, row.linked_workspace_id),
  );
}

const router = Router();
router.use(agentActions(false));
router.use("/:id/workspace/artifacts", artifactRoutes(false));

router.post("/:id/workspace/select-directory", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  if (agentRuntime.busy(ownerUuid, row.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
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
  if (agentRuntime.busy(ownerUuid, row.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  const previous = getSessionById(ownerUuid, row.id)?.linked_workspace_id;
  patchSessionRow(ownerUuid, row.id, {
    workspace_kind: "local",
    session_directory: path,
    linked_workspace_id: null,
  });
  appendSessionEvent(ownerUuid, row.id, `Working directory changed to ${path}`);
  await releaseWorkspaces(ownerUuid, [previous ?? null]);
  res.json({
    workspace: {
      kind: "local",
      path,
      label: path.split(/[\\/]/).pop() || path,
    },
  });
});

router.post("/:id/workspace/use-sandbox", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  if (agentRuntime.busy(ownerUuid, row.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  await workspaceService.provisionRetained(ownerUuid, row.id);
  const current = getSessionById(ownerUuid, row.id);
  if (current?.workspace_kind === "sandbox" && !current.linked_workspace_id) {
    res.json({ workspace: { kind: "sandbox" } });
    return;
  }
  patchSessionRow(ownerUuid, row.id, {
    workspace_kind: "sandbox",
    session_directory: null,
    linked_workspace_id: null,
  });
  appendSessionEvent(ownerUuid, row.id, "Returned to the private workspace");
  await releaseWorkspaces(ownerUuid, [current?.linked_workspace_id ?? null]);
  res.json({ workspace: { kind: "sandbox" } });
});

router.post("/:id/workspace/link", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  if (agentRuntime.busy(ownerUuid, row.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  const parsed = LinkWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const source = getSessionById(ownerUuid, parsed.data.sessionId);
  if (!source) {
    sendError(res, "NOT_FOUND", "Chat not found");
    return;
  }
  if (source.id === row.id) {
    sendError(
      res,
      "INVALID_REQUEST",
      "Choose another chat to link its workspace",
    );
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
  if (row.workspace_kind === "sandbox" && row.linked_workspace_id === linked) {
    res.json({ workspace: presentWorkspace(row) });
    return;
  }
  // No await separates reading the source from recording the reference.
  patchSessionRow(ownerUuid, row.id, {
    workspace_kind: "sandbox",
    session_directory: null,
    linked_workspace_id: linked,
  });
  const updated = getSessionById(ownerUuid, row.id);
  if (!updated) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  const workspace = presentWorkspace(updated);
  appendSessionEvent(
    ownerUuid,
    row.id,
    workspace.kind === "sandbox" && workspace.linked
      ? `Now linked to the workspace of "${workspace.linked.label}"`
      : "Returned to the private workspace",
  );
  await releaseWorkspaces(ownerUuid, [row.linked_workspace_id]);
  res.json({ workspace });
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
  createSessionRow(ownerUuid, id, now, model);
  try {
    await workspaceService.provisionRetained(ownerUuid, id);
  } catch (error) {
    deleteSessionRow(ownerUuid, id);
    throw error;
  }
  agentRuntime.main(ownerUuid, id);
  res.status(201).json({ id, createdAt: now, updatedAt: now });
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
  const ok = await agentRuntime.deleteSession(ownerUuid, row.id, async () => {
    const current = getSessionById(ownerUuid, row.id);
    // Delete first so the reference check no longer counts this chat.
    if (!current || !deleteSessionRow(ownerUuid, row.id)) return false;
    await releaseWorkspaces(ownerUuid, [
      current.id,
      current.linked_workspace_id,
    ]);
    return true;
  });
  if (!ok) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  res.json({ ok: true });
});

export default router;
