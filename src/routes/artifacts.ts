import { Router } from "express";
import { downloadWorkspaceFile } from "../http/downloadWorkspaceFile";
import { requestSession } from "../http/sessionRoute";
import { workspaceService } from "../workspaces/WorkspaceService";
import {
  listArtifactDirectory,
  readArtifactPreview,
} from "../workspaces/artifacts";

export function artifactRoutes() {
  const router = Router();
  for (const action of ["tree", "preview", "download"] as const) {
    router.get(`/${action}`, async (req, res) => {
      const workspace = await workspaceService.resolveSession(
        requestSession(req),
      );
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
