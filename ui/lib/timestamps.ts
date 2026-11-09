import { type Timestamp, timestampMs } from "@bufbuild/protobuf/wkt";

/** Milliseconds since the epoch, or 0 for a time the server left unset. */
export function toMillis(timestamp: Timestamp | undefined): number {
  return timestamp ? timestampMs(timestamp) : 0;
}

/** Milliseconds since the epoch, or null for an absent optional time. */
export function optionalMillis(
  timestamp: Timestamp | undefined,
): number | null {
  return timestamp ? timestampMs(timestamp) : null;
}
