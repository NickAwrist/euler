import { expect, test } from "bun:test";
import { formatExpiresIn } from "../../ui/lib/formatExpiresIn";

const minute = 60_000;
const hour = 60 * minute;

test("shows whole hours down to one hour, then minutes with a one-minute floor", () => {
  expect(formatExpiresIn(24 * hour, 0)).toBe("Expires in 24h");
  expect(formatExpiresIn(2 * hour - 1, 0)).toBe("Expires in 1h");
  expect(formatExpiresIn(hour, 0)).toBe("Expires in 1h");
  expect(formatExpiresIn(hour - 1, 0)).toBe("Expires in 59m");
  expect(formatExpiresIn(30 * minute, 0)).toBe("Expires in 30m");
  expect(formatExpiresIn(30_000, 0)).toBe("Expires in 1m");
  expect(formatExpiresIn(-minute, 0)).toBe("Expires in 1m");
});
