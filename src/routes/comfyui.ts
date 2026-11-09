import { Readable } from "node:stream";
import { Router } from "express";
import { getComfyUIClient } from "../comfyui/client";
import { asyncRoute } from "../http/asyncRoute";
import { sendError, sendValidationError } from "../observability/http";
import { logEvent } from "../observability/logger";
import { ComfyUIViewQuerySchema } from "../schemas/comfyui";

/** Generated images, loaded by URL from Markdown, so they stay plain GETs. */
const router = Router();

// Viewing a generated image from the ComfyUI server.
router.get(
  "/view/:filename",
  asyncRoute(async (req, res) => {
    const rawFilename = req.params.filename;
    const filename = Array.isArray(rawFilename) ? rawFilename[0] : rawFilename;
    if (!filename) {
      sendError(res, "INVALID_REQUEST", "filename is required");
      return;
    }
    const q = ComfyUIViewQuerySchema.safeParse(req.query);
    if (!q.success) {
      sendValidationError(res, q.error);
      return;
    }
    const { subfolder, type } = q.data;

    const client = getComfyUIClient();
    const upstream = await client.fetchViewAsset(filename, subfolder, type);
    if (!upstream.ok) {
      logEvent("warn", "comfyui.view_rejected", { status: upstream.status });
      sendError(res, "COMFY_ASSET_UNAVAILABLE");
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    if (upstream.body) {
      Readable.fromWeb(
        upstream.body as unknown as import("node:stream/web").ReadableStream,
      ).pipe(res);
    } else {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    }
  }),
);

export default router;
