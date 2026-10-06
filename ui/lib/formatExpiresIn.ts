const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Whole hours left, or minutes under an hour: "Expires in 5h", "Expires in 42m". */
export function formatExpiresIn(expiresAt: number, now: number): string {
  const remaining = expiresAt - now;
  if (remaining >= HOUR_MS)
    return `Expires in ${Math.floor(remaining / HOUR_MS)}h`;
  return `Expires in ${Math.max(1, Math.floor(remaining / MINUTE_MS))}m`;
}
