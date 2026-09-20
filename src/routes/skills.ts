import { Router } from "express";
import {
  createSkillRow,
  deleteSkillRow,
  getSkillById,
  listSkills,
  updateSkillRow,
} from "../db/index";
import { errorMessage, sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { SkillWriteSchema } from "../schemas/skills";
import { requireUserId } from "../userIdentity";

const skillsRoutes = Router();

skillsRoutes.get("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  res.json({ skills: listSkills(ownerUuid) });
});

skillsRoutes.get("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const skill = getSkillById(ownerUuid, req.params.id);
  if (!skill) {
    sendApiError(res, 404, "NOT_FOUND", "Skill not found");
    return;
  }
  res.json(skill);
});

skillsRoutes.post("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = SkillWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  try {
    res.status(201).json(createSkillRow(ownerUuid, parsed.data));
  } catch (error: unknown) {
    if (errorMessage(error).includes("UNIQUE constraint")) {
      sendApiError(
        res,
        409,
        "CONFLICT",
        "A skill with that name already exists",
      );
      return;
    }
    throw error;
  }
});

skillsRoutes.put("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = SkillWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  try {
    const skill = updateSkillRow(ownerUuid, req.params.id, parsed.data);
    if (!skill) {
      sendApiError(res, 404, "NOT_FOUND", "Skill not found");
      return;
    }
    res.json(skill);
  } catch (error: unknown) {
    if (errorMessage(error).includes("UNIQUE constraint")) {
      sendApiError(
        res,
        409,
        "CONFLICT",
        "A skill with that name already exists",
      );
      return;
    }
    throw error;
  }
});

skillsRoutes.delete("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (!deleteSkillRow(ownerUuid, req.params.id)) {
    sendApiError(res, 404, "NOT_FOUND", "Skill not found");
    return;
  }
  res.json({ ok: true });
});

export default skillsRoutes;
