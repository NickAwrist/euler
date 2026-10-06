import { useEffect, useState } from "react";
import { formatExpiresIn } from "../lib/formatExpiresIn";

/** An ephemeral chat's remaining lifetime, updated the moment it changes. */
export function ExpiresIn({
  expiresAt,
  className,
}: {
  expiresAt: number;
  className?: string;
}) {
  const [now, setNow] = useState(Date.now);
  // Waking on the expiry's minute boundaries, rather than every minute from
  // mount, keeps every display of the same expiry in step.
  useEffect(() => {
    const remaining = expiresAt - now;
    // Under two minutes it shows its one-minute floor until deleted.
    if (remaining < 2 * 60_000) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      (remaining % 60_000) + 1,
    );
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return (
    <time
      dateTime={new Date(expiresAt).toISOString()}
      title={`Deleted ${new Date(expiresAt).toLocaleString()}`}
      className={className}
    >
      {formatExpiresIn(expiresAt, now)}
    </time>
  );
}
