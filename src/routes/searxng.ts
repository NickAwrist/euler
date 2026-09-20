import { Router } from "express";
import { withContainerLoopbackHint } from "../containerNetworkHint";
import { setSearXNGHost } from "../db/index";
import { envConfig } from "../env";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { sendValidationError } from "../http/validation";
import {
  SearXNGConfigPutSchema,
  SearXNGTestBodySchema,
} from "../schemas/searxng";
import {
  SearXNGClient,
  getResolvedSearXNGHost,
  getSearXNGClient,
  getSearXNGHostConfig,
  invalidateSearXNGClient,
} from "../searxng/client";

const router = Router();

router.get("/health", async (_req, res) => {
  const result = await getSearXNGClient().healthCheck(3000);
  res.json({ connected: result.ok, error: result.error });
});

router.get("/config", (_req, res) => {
  res.json(getSearXNGHostConfig());
});

router.put("/config", (req, res) => {
  const parsed = SearXNGConfigPutSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  if (parsed.data.host !== undefined) {
    if (canEditEnvironmentSetting(envConfig.searxngHost, parsed.data.host)) {
      setSearXNGHost(parsed.data.host);
    }
    invalidateSearXNGClient();
  }
  res.json(getSearXNGHostConfig());
});

router.post("/test", async (req, res) => {
  const parsed = SearXNGTestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const raw = parsed.data.host?.trim() ?? "";
  const url = raw || getResolvedSearXNGHost();
  const result = await new SearXNGClient(url).healthCheck(5000);
  res.json({
    ok: result.ok,
    error: result.error
      ? withContainerLoopbackHint(result.error, url)
      : undefined,
  });
});

export default router;
