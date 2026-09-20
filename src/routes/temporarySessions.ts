import { Router } from "express";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { errorMessage, sendApiError } from "../http/errors";

import { isLoopbackRequest } from "../http/isLoopbackRequest";
import { revealFileNative } from "../nativeFolderPicker";
import { SelectDirectorySchema } from "../schemas/workspace";
import { requireUserId } from "../userIdentity";
import {
  WorkspaceError,
  workspaceService,
} from "../workspaces/WorkspaceService";
import { artifactRoutes } from "./artifacts";

const router = Router();
router.use("/:id/artifacts", artifactRoutes(true));

router.post("/", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const lease = await workspaceService.createTemporary(ownerUuid);
  res.status(201).json({ id: lease.id, expiresAt: lease.expiresAt });
});

router.post("/:id/workspace/select-directory", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
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
  if (workspaceService.isTurnActive(ownerUuid, req.params.id)) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  try {
    workspaceService.temporaryPresentation(ownerUuid, req.params.id);
    const path = await workspaceService.canonicalDirectory(parsed.data.path);
    if (workspaceService.isTurnActive(ownerUuid, req.params.id)) {
      sendApiError(
        res,
        409,
        "CONFLICT",
        "Wait for the current turn to finish before changing workspaces",
      );
      return;
    }
    const workspace = await workspaceService.selectTemporaryDirectory(
      ownerUuid,
      req.params.id,
      path,
    );
    res.json({ workspace });
  } catch (error) {
    sendApiError(
      res,
      error instanceof WorkspaceError ? 400 : 500,
      error instanceof WorkspaceError ? "BAD_REQUEST" : "INTERNAL_ERROR",
      errorMessage(error) || "Could not select directory",
    );
  }
});

router.post("/:id/workspace/use-sandbox", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (workspaceService.isTurnActive(ownerUuid, req.params.id)) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  try {
    res.json({
      workspace: workspaceService.useTemporarySandbox(ownerUuid, req.params.id),
    });
  } catch (error) {
    sendApiError(
      res,
      404,
      "NOT_FOUND",
      errorMessage(error) || "Temporary chat not found",
    );
  }
});

router.get("/:id/files", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  try {
    const workspace = await workspaceService.resolveTemporary(
      ownerUuid,
      req.params.id,
    );
    res.json({
      files: (await workspaceService.listFiles(workspace)).slice(0, 200),
    });
  } catch (error) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      errorMessage(error) || "Could not list workspace files",
    );
  }
});

router.post("/:id/reveal", async (req, res) => {
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
  const requestedPath =
    typeof (req.body as { path?: unknown }).path === "string"
      ? (req.body as { path: string }).path
      : "";
  try {
    const workspace = await workspaceService.resolveTemporary(
      ownerUuid,
      req.params.id,
    );
    if (workspace.kind !== "local") {
      throw new WorkspaceError("Only local workspace files can be revealed");
    }
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

router.delete("/:id", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (workspaceService.isTurnActive(ownerUuid, req.params.id)) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "Stop the current turn before closing this temporary chat",
    );
    return;
  }
  const deleted = await workspaceService.deleteTemporary(
    ownerUuid,
    req.params.id,
  );
  if (!deleted) {
    sendApiError(res, 404, "NOT_FOUND", "Temporary chat not found");
    return;
  }
  res.json({ ok: true });
});

router.get("/:id/file", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const requestedPath =
    typeof req.query.path === "string" ? req.query.path : "";
  try {
    const workspace = await workspaceService.resolveTemporary(
      ownerUuid,
      req.params.id,
    );
    if (workspace.kind !== "sandbox") {
      sendApiError(
        res,
        403,
        "FORBIDDEN",
        "Local files cannot be downloaded through this route",
      );
      return;
    }
    await downloadWorkspaceFile(res, workspace, requestedPath);
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      errorMessage(error) || "Could not download file",
    );
  }
});

export default router;
