import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { safeStorage } from "../../ui/lib/safeStorage";
import {
  loadThinkingPreferences,
  saveThinkingPreference,
} from "../../ui/persist/thinkingPreferences";
import { resetFallbackUserIdForTests } from "../../ui/persist/userIdentity";

afterEach(() => {
  mock.restore();
  resetFallbackUserIdForTests();
});

test("thinking preferences reject malformed stored data", () => {
  const read = spyOn(safeStorage, "getJSON");
  for (const value of [null, [], { local: 3 }, { local: "" }]) {
    read.mockReturnValue(value);
    expect(loadThinkingPreferences()).toEqual({});
  }
  read.mockReturnValue({ local: "high", "openrouter:test/remote": "off" });
  expect(loadThinkingPreferences()).toEqual({
    local: "high",
    "openrouter:test/remote": "off",
  });
});

test("thinking preferences persist under the current user's key", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  spyOn(safeStorage, "getItem").mockReturnValue(user);
  spyOn(safeStorage, "getJSON").mockReturnValue({});
  const write = spyOn(safeStorage, "setJSON").mockReturnValue(true);
  saveThinkingPreference("local", "high");
  expect(write).toHaveBeenCalledWith(`euler:thinkingPreferences:${user}`, {
    local: "high",
  });
});

test("storage failure does not prevent selecting thinking preferences", () => {
  spyOn(safeStorage, "getJSON").mockReturnValue({
    local: "medium",
    "openrouter:test/remote": "low",
  });
  spyOn(safeStorage, "setJSON").mockReturnValue(false);
  expect(
    saveThinkingPreference("local", "off", {
      "openrouter:test/remote": "high",
    }),
  ).toEqual({ local: "off", "openrouter:test/remote": "high" });
});

test("saving one model preserves the latest stored preferences for other models", () => {
  const read = spyOn(safeStorage, "getJSON").mockReturnValue({
    local: "high",
    "openrouter:test/remote": "off",
  });
  const write = spyOn(safeStorage, "setJSON").mockReturnValue(true);
  expect(
    saveThinkingPreference("openrouter:test/remote", "low", {
      local: "low",
      removed: "high",
    }),
  ).toEqual({
    local: "high",
    "openrouter:test/remote": "low",
  });
  read.mockReturnValue({ local: "medium", "openrouter:test/remote": "low" });
  saveThinkingPreference("openrouter:test/remote", "high");
  expect(write).toHaveBeenLastCalledWith(expect.any(String), {
    local: "medium",
    "openrouter:test/remote": "high",
  });
});
