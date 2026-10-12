import type { Database } from "bun:sqlite";
import { getDb, transaction } from "./connection";
import { seedDefaultSkills } from "./skills/queries";

/** Owners already set up, per connection, so requests skip the transaction. */
const readyOwners = new WeakMap<Database, Set<string>>();

export function ensureUserData(ownerUuid: string): void {
  const db = getDb();
  let owners = readyOwners.get(db);
  if (!owners) {
    owners = new Set();
    readyOwners.set(db, owners);
  }
  if (owners.has(ownerUuid)) return;
  transaction(() => seedDefaultSkills(ownerUuid));
  owners.add(ownerUuid);
}
