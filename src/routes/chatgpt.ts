import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../http/asyncRoute";
import {
  chatGptStatus,
  disconnectChatGpt,
  finishChatGptLogin,
  startChatGptLogin,
} from "../models/chatgpt";
import { OperationError } from "../observability/errors";
import { sendError, sendValidationError } from "../observability/http";
import { requireUserId } from "../userIdentity";

const routes = Router();
routes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
routes.get("/", (req, res) => {
  const owner = requireUserId(req, res);
  if (owner) res.json(chatGptStatus(owner));
});
routes.post("/login", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const parsed = z
    .object({ newAccount: z.boolean().default(false) })
    .safeParse(req.body ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  res.json(startChatGptLogin(owner, parsed.data.newAccount));
});
routes.post(
  "/callback",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const parsed = z
      .object({ callbackUrl: z.string().url().max(16384) })
      .safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    try {
      res.json(await finishChatGptLogin(owner, parsed.data.callbackUrl));
    } catch (error) {
      sendError(
        res,
        "INVALID_REQUEST",
        error instanceof OperationError
          ? error.message
          : "ChatGPT sign-in failed. Start again and paste the complete callback URL.",
      );
    }
  }),
);
routes.delete(
  "/",
  asyncRoute(async (req, res) => {
    const owner = requireUserId(req, res);
    if (owner) res.json(await disconnectChatGpt(owner));
  }),
);
export default routes;
