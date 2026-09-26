import type { SessionSummary } from "../../types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SessionGroup = {
  label: string;
  sessions: SessionSummary[];
};

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupLabel(updatedAt: number, now: number): string {
  const daysAgo = Math.round((startOfDay(now) - startOfDay(updatedAt)) / DAY);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 days";
  if (daysAgo <= 30) return "Previous 30 days";
  return "Older";
}

/** Groups sessions, already sorted newest first, by calendar recency. */
export function groupSessionsByDate(
  sessions: SessionSummary[],
  now: number,
): SessionGroup[] {
  const groups: SessionGroup[] = [];
  for (const session of sessions) {
    const label = groupLabel(session.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.sessions.push(session);
    else groups.push({ label, sessions: [session] });
  }
  return groups;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  style: "short",
});

export function formatSessionTime(updatedAt: number, now: number): string {
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR)
    return relativeTime.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY)
    return relativeTime.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY)
    return relativeTime.format(-Math.floor(elapsed / DAY), "day");
  const date = new Date(updatedAt);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
}
