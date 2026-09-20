import type { SkillData, SkillWriteBody } from "../../src/schemas/skills";
import { apiJson, apiVoid } from "../lib/api";

export type { SkillData, SkillWriteBody };

export async function fetchSkills(): Promise<SkillData[]> {
  const data = await apiJson<{ skills?: SkillData[] }>("/api/skills", {
    errorMessage: "Failed to fetch skills",
  });
  return data.skills ?? [];
}

export function createSkillApi(body: SkillWriteBody): Promise<SkillData> {
  return apiJson<SkillData>("/api/skills", {
    method: "POST",
    json: body,
    errorMessage: "Failed to create skill",
  });
}

export function updateSkillApi(
  id: string,
  body: SkillWriteBody,
): Promise<SkillData> {
  return apiJson<SkillData>(`/api/skills/${id}`, {
    method: "PUT",
    json: body,
    errorMessage: "Failed to update skill",
  });
}

export function deleteSkillApi(id: string): Promise<void> {
  return apiVoid(`/api/skills/${id}`, {
    method: "DELETE",
    errorMessage: "Failed to delete skill",
  });
}
