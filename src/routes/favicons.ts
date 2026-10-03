import { Router } from "express";
import { getFavicon } from "../favicons/faviconService";
import { asyncRoute } from "../http/asyncRoute";
import { sendError, sendValidationError } from "../observability/http";
import { FaviconParamsSchema } from "../schemas/favicons";

const router = Router();

// Serving a site's favicon so browsers never contact the site or a third party.
router.get(
  "/:hostname",
  asyncRoute(async (req, res) => {
    const parsed = FaviconParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const favicon = await getFavicon(parsed.data.hostname);
    if (!favicon) {
      sendError(res, "NOT_FOUND", "Favicon not found");
      return;
    }
    res.setHeader("Content-Type", favicon.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // SVG icons can carry scripts; keep them inert if opened directly.
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(Buffer.from(favicon.body));
  }),
);

export default router;
