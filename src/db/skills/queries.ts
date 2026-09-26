import crypto from "node:crypto";
import { getDb } from "../connection";
import type { SkillRow } from "./types";

export type SkillWriteData = {
  name: string;
  description: string;
  instructions: string;
  user_invocable: boolean;
  disable_model_invocation: boolean;
};

type StoredSkillRow = Omit<
  SkillRow,
  "user_invocable" | "disable_model_invocation"
> & {
  user_invocable: number;
  disable_model_invocation: number;
};

const SKILL_COLUMNS =
  "id, owner_uuid, name, description, instructions, user_invocable, disable_model_invocation, created_at, updated_at";

function toSkillRow(row: StoredSkillRow): SkillRow {
  return {
    ...row,
    user_invocable: row.user_invocable === 1,
    disable_model_invocation: row.disable_model_invocation === 1,
  };
}

export function listSkills(ownerUuid: string): SkillRow[] {
  return (
    getDb()
      .query(
        `SELECT ${SKILL_COLUMNS} FROM skills WHERE owner_uuid = ? ORDER BY created_at ASC`,
      )
      .all(ownerUuid) as StoredSkillRow[]
  ).map(toSkillRow);
}

export function getSkillById(ownerUuid: string, id: string): SkillRow | null {
  const row = getDb()
    .query(
      `SELECT ${SKILL_COLUMNS} FROM skills WHERE owner_uuid = ? AND id = ?`,
    )
    .get(ownerUuid, id) as StoredSkillRow | null;
  return row && toSkillRow(row);
}

export function getSkillByName(
  ownerUuid: string,
  name: string,
): SkillRow | null {
  const row = getDb()
    .query(
      `SELECT ${SKILL_COLUMNS} FROM skills WHERE owner_uuid = ? AND name = ?`,
    )
    .get(ownerUuid, name) as StoredSkillRow | null;
  return row && toSkillRow(row);
}

export function createSkillRow(
  ownerUuid: string,
  data: SkillWriteData,
): SkillRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb().run(
    `INSERT INTO skills (${SKILL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ownerUuid,
      data.name,
      data.description,
      data.instructions,
      Number(data.user_invocable),
      Number(data.disable_model_invocation),
      now,
      now,
    ],
  );
  return {
    id,
    owner_uuid: ownerUuid,
    ...data,
    created_at: now,
    updated_at: now,
  };
}

export function updateSkillRow(
  ownerUuid: string,
  id: string,
  data: SkillWriteData,
): SkillRow | null {
  const now = Date.now();
  const result = getDb().run(
    "UPDATE skills SET name = ?, description = ?, instructions = ?, user_invocable = ?, disable_model_invocation = ?, updated_at = ? WHERE owner_uuid = ? AND id = ?",
    [
      data.name,
      data.description,
      data.instructions,
      Number(data.user_invocable),
      Number(data.disable_model_invocation),
      now,
      ownerUuid,
      id,
    ],
  );
  if (result.changes === 0) return null;
  return getSkillById(ownerUuid, id);
}

export function deleteSkillRow(ownerUuid: string, id: string): boolean {
  return (
    getDb().run("DELETE FROM skills WHERE owner_uuid = ? AND id = ?", [
      ownerUuid,
      id,
    ]).changes > 0
  );
}
