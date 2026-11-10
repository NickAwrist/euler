import { getDb } from "./connection";

export type DeviceRow = {
  token: string;
  owner_uuid: string;
  environment: "sandbox" | "production";
  bundle_id: string;
  updated_at: number;
};

/** Registers the token for the owner, moving it from any previous owner. */
export function saveDevice(
  device: Omit<DeviceRow, "updated_at" | "token"> & { token: string },
) {
  getDb().run(
    `INSERT INTO devices (token, owner_uuid, environment, bundle_id, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET owner_uuid = excluded.owner_uuid,
       environment = excluded.environment, bundle_id = excluded.bundle_id,
       updated_at = excluded.updated_at`,
    [
      device.token.toLowerCase(),
      device.owner_uuid,
      device.environment,
      device.bundle_id,
      Date.now(),
    ],
  );
}

export function deleteDevice(ownerUuid: string, token: string) {
  getDb().run("DELETE FROM devices WHERE owner_uuid = ? AND token = ?", [
    ownerUuid,
    token.toLowerCase(),
  ]);
}

/** Drops a token APNs reported as no longer valid. */
export function forgetDeviceToken(token: string) {
  getDb().run("DELETE FROM devices WHERE token = ?", [token.toLowerCase()]);
}

export function listDevices(ownerUuid: string): DeviceRow[] {
  return getDb()
    .query("SELECT * FROM devices WHERE owner_uuid = ?")
    .all(ownerUuid) as DeviceRow[];
}
