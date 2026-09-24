import { getDb } from "./connection";
import { LEGACY_USER_DATA_CLAIMED_BY_KEY } from "./constants";

export function ensureUserData(ownerUuid: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const legacyOwner = db
      .query("SELECT value FROM app_settings WHERE key = ?")
      .get(LEGACY_USER_DATA_CLAIMED_BY_KEY) as { value: string } | null;
    const hasLegacyData =
      db
        .query("SELECT 1 FROM sessions WHERE owner_uuid IS NULL LIMIT 1")
        .get() != null;

    if (!legacyOwner && hasLegacyData) {
      db.run("UPDATE sessions SET owner_uuid = ? WHERE owner_uuid IS NULL", [
        ownerUuid,
      ]);
      db.run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [
        LEGACY_USER_DATA_CLAIMED_BY_KEY,
        ownerUuid,
      ]);
    }
  });
  tx();
}
