import { Router } from "express";
import { getSessionById } from "../db/sessions";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { sendApiError } from "../http/errors";
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";
import {
  listArtifactDirectory,
  readArtifactPreview,
} from "../workspaces/artifacts";

export function artifactRoutes(temporary: boolean) {
  const router = Router({ mergeParams: true });
  for (const action of ["tree", "preview", "download"] as const) {
    router.get(`/${action}`, async (req, res) => {
      const owner = requireUserId(req, res);
      if (!owner) return;
      const id = (req.params as { id: string }).id;
      try {
        const row = temporary ? null : getSessionById(owner, id);
        if (!temporary && !row) {
          sendApiError(res, 404, "NOT_FOUND", "Session not found");
          return;
        }
        const workspace = row
          ? await workspaceService.resolveSession(row)
          : await workspaceService.resolveTemporary(owner, id);
        const path = typeof req.query.path === "string" ? req.query.path : ".";
        res.setHeader("Cache-Control", "no-store");
        if (action === "download") {
          await downloadWorkspaceFile(res, workspace, path);
          return;
        }
        res.json(
          action === "tree"
            ? {
                entries: await listArtifactDirectory(
                  workspaceService,
                  workspace,
                  path,
                ),
              }
            : await readArtifactPreview(workspaceService, workspace, path),
        );
      } catch (error) {
        if (res.headersSent || res.destroyed) return;
        sendApiError(
          res,
          400,
          "BAD_REQUEST",
          error instanceof Error
            ? error.message
            : "Could not load workspace files",
        );
      }
    });
  }
  return router;
}
