import { describe, expect, test } from "bun:test";
import {
  InputCapability,
  parseInputCapabilities,
} from "../src/models/modelCapabilities";

describe("input capabilities", () => {
  test("accepts known provider values and rejects unknown values", () => {
    expect(
      parseInputCapabilities(["text", "image", "image", "document", 42]),
    ).toEqual([InputCapability.Text, InputCapability.Image]);
    expect(parseInputCapabilities("image")).toEqual([]);
  });
});
