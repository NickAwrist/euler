import { Router } from "express";
import { z } from "zod";
import {
  getBraveSearchApiKey,
  getOpenRouterApiKey,
  setBraveSearchApiKey,
  setOpenRouterApiKey,
} from "../db/index";
import { setModelFavorite } from "../db/openrouter";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import { envConfig, getEnvironmentSettings } from "../env";
import { asyncRoute } from "../http/asyncRoute";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { openRouterRouteSchema } from "../models/openRouterModels";
import { sendError, sendValidationError } from "../observability/http";
import {
  removeToolPermissionRule,
  saveToolPermissionRule,
} from "../permissions/preferences";
import { toolCatalog } from "../permissions/toolCatalog";
import { ToolPermissionRuleSchema } from "../schemas/toolPermissions";
import { userPreferencesPatchSchema } from "../schemas/userPreferences";
import { requireUserId } from "../userIdentity";

const settingsRoutes = Router();
settingsRoutes.get(
  "/user/tools",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    try {
      const tools = await toolCatalog(owner, controller.signal);
      res.setHeader("Cache-Control", "no-store");
      res.json({ tools });
    } finally {
      res.off("close", abort);
    }
  }),
);
settingsRoutes.put("/user/tool-permission-rules/:ruleId", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const parsed = ToolPermissionRuleSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  if (parsed.data.id !== req.params.ruleId)
    return sendError(res, "INVALID_REQUEST", "Rule ID does not match");
  res.json(saveToolPermissionRule(owner, parsed.data));
});
settingsRoutes.delete("/user/tool-permission-rules/:ruleId", (req, res) => {
  const owner = requireUserId(req, res);
  if (owner) res.json(removeToolPermissionRule(owner, req.params.ruleId));
});
settingsRoutes.get("/user", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  res.json(effectiveUserPreferences(owner));
});
settingsRoutes.patch("/user", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const parsed = userPreferencesPatchSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  res.json(updateUserPreferences(owner, parsed.data));
});

settingsRoutes.get("/environment", (_req, res) => {
  res.json(getEnvironmentSettings());
});

/** Expose whether a key exists without ever returning the key itself. */
function apiKeyRoutes(
  path: string,
  environmentKey: () => string,
  getKey: () => string,
  setKey: (key: string) => void,
) {
  settingsRoutes.get(path, (_req, res) => {
    res.json({
      hasKey: getKey().length > 0,
      environmentManaged: Boolean(environmentKey()),
    });
  });

  settingsRoutes.put(path, (req, res) => {
    const parsed = z
      .object({ apiKey: z.string().max(512).default("") })
      .safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "INVALID_REQUEST", "apiKey must be a string");
      return;
    }
    if (canEditEnvironmentSetting(environmentKey(), parsed.data.apiKey)) {
      setKey(parsed.data.apiKey);
    }
    res.json({ ok: true, hasKey: getKey().length > 0 });
  });
}

apiKeyRoutes(
  "/openrouter",
  () => envConfig.openrouterApiKey,
  getOpenRouterApiKey,
  setOpenRouterApiKey,
);
apiKeyRoutes(
  "/brave",
  () => envConfig.braveSearchApiKey,
  getBraveSearchApiKey,
  setBraveSearchApiKey,
);

settingsRoutes.put("/models/favorite", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const parsed = z
    .object({
      provider: z.enum(["openrouter", "ollama"]),
      modelId: z.string().trim().min(1).max(200),
      favorite: z.boolean(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return sendError(res, "INVALID_REQUEST", "Invalid model favorite");
  const { provider, modelId, favorite } = parsed.data;
  if (
    provider === "openrouter" &&
    (modelId.startsWith("openrouter:") ||
      !openRouterRouteSchema.safeParse(modelId).success)
  )
    return sendError(res, "INVALID_REQUEST", "Use a raw OpenRouter route");
  setModelFavorite(owner, provider, modelId, favorite);
  res.json({ ok: true });
});
export default settingsRoutes;
