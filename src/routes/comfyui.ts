import { Readable } from "node:stream";
import { Router } from "express";
import {
  ComfyUIClient,
  getComfyUIClient,
  getComfyUIHostConfig,
  getResolvedComfyUIHost,
  invalidateComfyUIClient,
} from "../comfyui/client";
import { withContainerLoopbackHint } from "../containerNetworkHint";
import {
  getComfyUIDefaultModel,
  getComfyUIImageSize,
  getComfyUINegativePrompt,
  setComfyUIDefaultModel,
  setComfyUIHost,
  setComfyUIImageSize,
  setComfyUINegativePrompt,
} from "../db/index";
import { asyncRoute } from "../http/asyncRoute";
import { sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { logger } from "../logger";
import {
  ComfyUIConfigPutSchema,
  ComfyUITestBodySchema,
  ComfyUIViewQuerySchema,
} from "../schemas/comfyui";
import { errorMessage } from "../utils/errors";

const router = Router();
const log = logger.child({ route: "comfyui" });

// Checking the health of the ComfyUI server.
router.get("/health", async (_req, res) => {
  try {
    const client = getComfyUIClient();
    const result = await client.healthCheck();
    res.json({ connected: result.ok, error: result.error });
  } catch (e) {
    log.error({ err: e }, "comfyui health");
    res.json({
      connected: false,
      error: errorMessage(e),
    });
  }
});

// Getting the user's comfyUI configuration.
router.get("/config", (_req, res) => {
  const { width, height } = getComfyUIImageSize();
  res.json({
    ...getComfyUIHostConfig(),
    defaultModel: getComfyUIDefaultModel(),
    defaultWidth: width,
    defaultHeight: height,
    negativePrompt: getComfyUINegativePrompt(),
  });
});

// Updating the user's comfyUI configuration.
router.put("/config", (req, res) => {
  const parsed = ComfyUIConfigPutSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data;
  if (body.host !== undefined) {
    setComfyUIHost(body.host);
    invalidateComfyUIClient();
  }
  if (body.defaultModel !== undefined) {
    setComfyUIDefaultModel(body.defaultModel);
  }
  if (body.defaultWidth !== undefined && body.defaultHeight !== undefined) {
    setComfyUIImageSize(body.defaultWidth, body.defaultHeight);
  }
  if (body.negativePrompt !== undefined) {
    setComfyUINegativePrompt(body.negativePrompt);
  }
  const { width, height } = getComfyUIImageSize();
  res.json({
    ...getComfyUIHostConfig(),
    defaultModel: getComfyUIDefaultModel(),
    defaultWidth: width,
    defaultHeight: height,
    negativePrompt: getComfyUINegativePrompt(),
  });
});

// Testing the connection to the ComfyUI server.
router.post("/test", async (req, res) => {
  const parsed = ComfyUITestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const raw = parsed.data.host?.trim() ?? "";
  const url = raw || getResolvedComfyUIHost();
  const client = new ComfyUIClient(url);
  const result = await client.healthCheck();
  res.json({
    ok: result.ok,
    error: result.error
      ? withContainerLoopbackHint(result.error, url)
      : undefined,
  });
});

// Getting the available models from the ComfyUI server.
router.get("/models", async (_req, res) => {
  try {
    const client = getComfyUIClient();
    const models = await client.getModels();
    res.json({ models });
  } catch (e) {
    log.error({ err: e }, "comfyui models");
    res.json({ models: [], error: errorMessage(e) });
  }
});

// Viewing a generated image from the ComfyUI server.
router.get(
  "/view/:filename",
  asyncRoute(async (req, res) => {
    const rawFilename = req.params.filename;
    const filename = Array.isArray(rawFilename) ? rawFilename[0] : rawFilename;
    if (!filename) {
      sendApiError(res, 400, "BAD_REQUEST", "filename is required");
      return;
    }
    const q = ComfyUIViewQuerySchema.safeParse(req.query);
    if (!q.success) {
      sendValidationError(res, q.error, "Invalid query");
      return;
    }
    const { subfolder, type } = q.data;

    try {
      const client = getComfyUIClient();
      const upstream = await client.fetchViewAsset(filename, subfolder, type);
      if (!upstream.ok) {
        sendApiError(
          res,
          upstream.status,
          "UPSTREAM_ERROR",
          `ComfyUI returned ${upstream.status}`,
        );
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
    } catch (e) {
      log.error({ err: e }, "comfyui view proxy");
      sendApiError(res, 502, "UPSTREAM_ERROR", errorMessage(e));
    }
  }),
);

export default router;
