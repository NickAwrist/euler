import { describe, expect, test } from "bun:test";
import {
  formatSessionTime,
  groupSessionsByDate,
} from "../../ui/components/Sidebar/sessionDates";

const now = new Date(2026, 8, 25, 9, 30).getTime();

function session(id: string, updatedAt: Date) {
  return {
    id,
    preview: id,
    createdAt: 0,
    updatedAt: updatedAt.getTime(),
  };
}

describe("session dates", () => {
  test("groups by calendar day rather than elapsed hours", () => {
    const groups = groupSessionsByDate(
      [
        session("this-morning", new Date(2026, 8, 25, 0, 5)),
        session("late-last-night", new Date(2026, 8, 24, 23, 55)),
        session("last-week", new Date(2026, 8, 18, 12)),
        session("last-month", new Date(2026, 7, 30, 12)),
        session("last-year", new Date(2025, 8, 25, 12)),
      ],
      now,
    );

    expect(
      groups.map((group) => [group.label, group.sessions.map((s) => s.id)]),
    ).toEqual([
      ["Today", ["this-morning"]],
      ["Yesterday", ["late-last-night"]],
      ["Previous 7 days", ["last-week"]],
      ["Previous 30 days", ["last-month"]],
      ["Older", ["last-year"]],
    ]);
  });

  test("uses relative times for recent chats and dates for older ones", () => {
    expect(formatSessionTime(now - 30_000, now)).toBe("Just now");
    expect(formatSessionTime(now - 5 * 60_000, now)).toMatch(/5 min/);
    expect(formatSessionTime(now - 3 * 3_600_000, now)).toMatch(/3 hr/);
    expect(formatSessionTime(now - 2 * 86_400_000, now)).toMatch(/2 days/);
    expect(formatSessionTime(new Date(2026, 8, 3).getTime(), now)).toBe(
      "Sep 3",
    );
    expect(formatSessionTime(new Date(2025, 8, 3).getTime(), now)).toBe(
      "Sep 3, 2025",
    );
  });
});
