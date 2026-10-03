import crypto from "node:crypto";
import { Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { withoutImageData } from "../db/agents";
import {
  appendSessionEvent,
  createSessionRow,
  deleteSessionRow,
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
import { SelectDirectorySchema } from "../schemas/workspace";
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";
import { agentActions } from "./agentActions";
import { artifactRoutes } from "./artifacts";

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
  patchSessionRow(ownerUuid, row.id, {
    workspace_kind: "local",
    session_directory: path,
  });
  appendSessionEvent(ownerUuid, row.id, `Working directory changed to ${path}`);
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
  if (getSessionById(ownerUuid, row.id)?.workspace_kind === "sandbox") {
    res.json({ workspace: { kind: "sandbox" } });
    return;
  }
  patchSessionRow(ownerUuid, row.id, {
    workspace_kind: "sandbox",
    session_directory: null,
  });
  appendSessionEvent(ownerUuid, row.id, "Returned to the private workspace");
  res.json({ workspace: { kind: "sandbox" } });
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
    workspace: workspaceService.presentation(row),
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
    await workspaceService.trashRetained(ownerUuid, row.id);
    return deleteSessionRow(ownerUuid, row.id);
  });
  if (!ok) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  res.json({ ok: true });
});

export default router;
