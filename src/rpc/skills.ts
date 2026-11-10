import type { ServiceImpl } from "@connectrpc/connect";
import { isUniqueViolation } from "../db/errors";
import {
  createSkillRow,
  deleteSkillRow,
  getSkillById,
  listSkills,
  updateSkillRow,
} from "../db/index";
import type { SkillRow } from "../db/skills/types";
import type { SkillFields, SkillService } from "../gen/euler/v1/skills_pb";
import { OperationError } from "../observability/errors";
import { ownerOf } from "./context";
import { millis } from "./wire";

const notFound = () =>
  new OperationError("NOT_FOUND", { message: "Skill not found" });

function skill(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    userInvocable: row.user_invocable,
    disableModelInvocation: row.disable_model_invocation,
    createdAt: millis(row.created_at),
    updatedAt: millis(row.updated_at),
  };
}

const fields = (value: SkillFields | undefined) => ({
  name: value?.name.trim() ?? "",
  description: value?.description.trim() ?? "",
  instructions: value?.instructions.trim() ?? "",
  user_invocable: value?.userInvocable ?? true,
  disable_model_invocation: value?.disableModelInvocation ?? false,
});

/** Runs a write, reporting a duplicate name as a conflict. */
function uniqueName<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (isUniqueViolation(error))
      throw new OperationError("CONFLICT", {
        message: "A skill with that name already exists",
      });
    throw error;
  }
}

export const skillService: ServiceImpl<typeof SkillService> = {
  listSkills(_request, context) {
    return { skills: listSkills(ownerOf(context)).map(skill) };
  },
  getSkill(request, context) {
    const row = getSkillById(ownerOf(context), request.id);
    if (!row) throw notFound();
    return { skill: skill(row) };
  },
  createSkill(request, context) {
    const owner = ownerOf(context);
    return {
      skill: skill(
        uniqueName(() => createSkillRow(owner, fields(request.skill))),
      ),
    };
  },
  updateSkill(request, context) {
    const owner = ownerOf(context);
    const row = uniqueName(() =>
      updateSkillRow(owner, request.id, fields(request.skill)),
    );
    if (!row) throw notFound();
    return { skill: skill(row) };
  },
  deleteSkill(request, context) {
    if (!deleteSkillRow(ownerOf(context), request.id)) throw notFound();
    return {};
  },
};
