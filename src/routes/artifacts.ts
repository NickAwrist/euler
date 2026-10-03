import { Router } from "express";
import { getSessionById } from "../db/sessions";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { sendError } from "../observability/http";
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";
import {
  listArtifactDirectory,
  readArtifactPreview,
} from "../workspaces/artifacts";

export function artifactRoutes() {
  const router = Router({ mergeParams: true });
  for (const action of ["tree", "preview", "download"] as const) {
    router.get(`/${action}`, async (req, res) => {
      const owner = requireUserId(req, res);
      if (!owner) return;
      const row = getSessionById(owner, (req.params as { id: string }).id);
      if (!row) {
        sendError(res, "NOT_FOUND", "Session not found");
        return;
      }
      const workspace = await workspaceService.resolveSession(row);
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
    });
  }
  return router;
}
