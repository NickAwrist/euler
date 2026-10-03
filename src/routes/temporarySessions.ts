import { Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { agentActions } from "./agentActions";

import { isLoopbackRequest } from "../http/isLoopbackRequest";
import { revealFileNative } from "../nativeFolderPicker";
import { sendError } from "../observability/http";
import { SelectDirectorySchema } from "../schemas/workspace";
import { requireUserId } from "../userIdentity";
import {
  WorkspaceError,
  workspaceService,
} from "../workspaces/WorkspaceService";
import { artifactRoutes } from "./artifacts";

const router = Router();
router.use(agentActions(true));
router.use("/:id/artifacts", artifactRoutes(true));

router.post("/", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const lease = await workspaceService.createTemporary(ownerUuid);
  agentRuntime.main(ownerUuid, lease.id, true);
  res.status(201).json({ id: lease.id, expiresAt: lease.expiresAt });
});

router.post("/:id/workspace/select-directory", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = SelectDirectorySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(
      res,
      "INVALID_REQUEST",
      "Enter an absolute folder path on the server",
    );
    return;
  }
  if (agentRuntime.busy(ownerUuid, req.params.id)) {
    sendError(
      res,
      "CONFLICT",
      "Wait for the current turn to finish before changing workspaces",
    );
    return;
  }
  workspaceService.temporaryPresentation(ownerUuid, req.params.id);
  const path = await workspaceService.canonicalDirectory(parsed.data.path);
  if (agentRuntime.busy(ownerUuid, req.params.id)) {
    sendError(
      res,
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
});

router.post("/:id/workspace/use-sandbox", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (agentRuntime.busy(ownerUuid, req.params.id)) {
    sendError(
      res,
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
    if (!(error instanceof WorkspaceError)) throw error;
    sendError(res, "NOT_FOUND", error.message);
  }
});

router.get("/:id/files", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const workspace = await workspaceService.resolveTemporary(
    ownerUuid,
    req.params.id,
  );
  res.json({
    files: (await workspaceService.listFiles(workspace)).slice(0, 200),
  });
});

router.post("/:id/reveal", async (req, res) => {
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
  const requestedPath =
    typeof (req.body as { path?: unknown }).path === "string"
      ? (req.body as { path: string }).path
      : "";
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
});

router.delete("/:id", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  // Settle every agent before its workspace is removed.
  const deleted = await agentRuntime.deleteSession(
    ownerUuid,
    req.params.id,
    () => workspaceService.deleteTemporary(ownerUuid, req.params.id),
  );
  if (!deleted) {
    sendError(res, "NOT_FOUND", "Temporary chat not found");
    return;
  }
  res.json({ ok: true });
});

router.get("/:id/file", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const requestedPath =
    typeof req.query.path === "string" ? req.query.path : "";
  const workspace = await workspaceService.resolveTemporary(
    ownerUuid,
    req.params.id,
  );
  if (workspace.kind !== "sandbox") {
    sendError(
      res,
      "FORBIDDEN",
      "Local files cannot be downloaded through this route",
    );
    return;
  }
  await downloadWorkspaceFile(res, workspace, requestedPath);
});

export default router;
