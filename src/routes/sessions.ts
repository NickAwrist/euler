import crypto from "node:crypto";
import { Router } from "express";
import {
  type WireMessage,
  appendSessionEvent,
  createSessionRow,
  deleteSessionRow,
  getMessagesForSession,
  getSessionById,
  listSessionSummaries,
  parseModelMessages,
  patchSessionRow,
  persistSessionMessages,
} from "../db/index";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { errorMessage, sendApiError } from "../http/errors";
import { isLoopbackRequest } from "../http/isLoopbackRequest";
import { sendValidationError } from "../http/validation";
import { stripReasoningFromModelMessages } from "../llm/reasoningDetails";
import { revealFileNative } from "../nativeFolderPicker";
import {
  CreateSessionBodySchema,
  PatchSessionBodySchema,
  RevealFileSchema,
} from "../schemas/sessions";
import { SelectDirectorySchema } from "../schemas/workspace";
import { requireUserId } from "../userIdentity";
import {
  WorkspaceError,
  workspaceService,
} from "../workspaces/WorkspaceService";
import { artifactRoutes } from "./artifacts";

const router = Router();
router.use("/:id/workspace/artifacts", artifactRoutes(false));

router.post("/:id/workspace/select-directory", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  if (workspaceService.isTurnActive(ownerUuid, row.id)) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  const parsed = SelectDirectorySchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      "Enter an absolute folder path on the server",
    );
    return;
  }
  try {
    const path = await workspaceService.canonicalDirectory(parsed.data.path);
    if (workspaceService.isTurnActive(ownerUuid, row.id)) {
      sendApiError(
        res,
        409,
        "CONFLICT",
        "Wait for the current turn to finish before changing workspaces",
      );
      return;
    }
    patchSessionRow(ownerUuid, row.id, {
      workspace_kind: "local",
      session_directory: path,
    });
    appendSessionEvent(
      ownerUuid,
      row.id,
      `Working directory changed to ${path}`,
    );
    res.json({
      workspace: {
        kind: "local",
        path,
        label: path.split(/[\\/]/).pop() || path,
      },
    });
  } catch (e) {
    sendApiError(
      res,
      e instanceof WorkspaceError ? 400 : 500,
      e instanceof WorkspaceError ? "BAD_REQUEST" : "INTERNAL_ERROR",
      errorMessage(e) || "Could not select directory",
    );
  }
});

router.post("/:id/workspace/use-sandbox", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  if (workspaceService.isTurnActive(ownerUuid, row.id)) {
    sendApiError(
      res,
      409,
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
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  try {
    const workspace = await workspaceService.resolveSession(row);
    const files = await workspaceService.listFiles(workspace);
    res.json({ files: files.slice(0, 200) });
  } catch (error) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      errorMessage(error) || "Could not list workspace files",
    );
  }
});

router.get("/:id/workspace/file", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  if (row.workspace_kind !== "sandbox") {
    sendApiError(
      res,
      403,
      "FORBIDDEN",
      "Local files cannot be downloaded through this route",
    );
    return;
  }
  const requestedPath =
    typeof req.query.path === "string" ? req.query.path : "";
  try {
    const workspace = await workspaceService.resolveSession(row);
    await downloadWorkspaceFile(res, workspace, requestedPath);
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      errorMessage(error) || "Could not download workspace file",
    );
  }
});

router.post("/:id/workspace/reveal", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (!isLoopbackRequest(req)) {
    sendApiError(
      res,
      403,
      "FORBIDDEN",
      "Files can only be revealed on the machine running Euler",
    );
    return;
  }
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  if (row.workspace_kind !== "local") {
    sendApiError(
      res,
      403,
      "FORBIDDEN",
      "Only local workspace files can be revealed",
    );
    return;
  }
  const parsed = RevealFileSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const requestedPath = parsed.data.path;
  try {
    const workspace = await workspaceService.resolveSession(row);
    const path = await workspaceService.resolveExistingPath(
      workspace,
      requestedPath,
    );
    await revealFileNative(path);
    res.json({ ok: true });
  } catch (error) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      errorMessage(error) || "Could not reveal file",
    );
  }
});

router.get("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const rows = listSessionSummaries(ownerUuid);
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      customTitle: r.title,
      preview: r.preview,
    })),
  });
});

router.get("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const id = req.params.id;
  const row = getSessionById(ownerUuid, id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
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
      parseModelMessages(row.model_messages),
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
  res.status(201).json({ id, createdAt: now, updatedAt: now });
});

router.patch("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const id = req.params.id;
  const row = getSessionById(ownerUuid, id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  const parsed = PatchSessionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data;
  const now = Date.now();

  if (Array.isArray(body.history)) {
    const hist = body.history as WireMessage[];
    const mm =
      "modelMessages" in body
        ? body.modelMessages === null || body.modelMessages === undefined
          ? null
          : Array.isArray(body.modelMessages)
            ? (body.modelMessages as Array<Record<string, unknown>>)
            : parseModelMessages(row.model_messages)
        : parseModelMessages(row.model_messages);
    const runModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : undefined;
    persistSessionMessages(ownerUuid, id, hist, mm, now, runModel);
  }

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
  if (
    "model" in body &&
    body.model !== undefined &&
    !Array.isArray(body.history)
  ) {
    const m = body.model;
    patch.model =
      m === null ? null : typeof m === "string" ? m.trim() || null : null;
  }
  if ("modelMessages" in body && !Array.isArray(body.history)) {
    const mm = body.modelMessages;
    patch.model_messages =
      mm === null || mm === undefined
        ? null
        : Array.isArray(mm)
          ? (mm as Array<Record<string, unknown>>)
          : null;
  }
  patchSessionRow(ownerUuid, id, patch);
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const row = getSessionById(ownerUuid, req.params.id);
  if (!row) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  if (workspaceService.isTurnActive(ownerUuid, row.id)) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "Stop the current turn before deleting this chat",
    );
    return;
  }
  await workspaceService.trashRetained(ownerUuid, row.id);
  const ok = deleteSessionRow(ownerUuid, req.params.id);
  if (!ok) {
    sendApiError(res, 404, "NOT_FOUND", "Session not found");
    return;
  }
  res.json({ ok: true });
});

export default router;
