import { describe, expect, test } from "bun:test";
import {
  exactRunCommand,
  matchingRunCommands,
} from "../../ui/components/runCommands";
import type { SessionWorkspace } from "../../ui/types";

const sandbox: SessionWorkspace = { kind: "sandbox" };
const local: SessionWorkspace = { kind: "local", path: "/tmp/a", label: "a" };
const linked: SessionWorkspace = {
  kind: "sandbox",
  linked: { workspaceId: "chat-a", sessionId: "chat-a" },
};
const names = (workspace: SessionWorkspace) =>
  matchingRunCommands("/", workspace).map((command) => command.name);

describe("run commands", () => {
  test("recognizes exact workspace commands for local UI handling", () => {
    expect(exactRunCommand("/directory")).toBe("directory");
    expect(exactRunCommand(" /sandbox ")).toBe("sandbox");
    expect(exactRunCommand("/link")).toBe("link");
    expect(exactRunCommand("/workspace")).toBe("workspace");
  });

  test("does not consume ordinary model messages", () => {
    expect(exactRunCommand("/directory please")).toBeNull();
    expect(exactRunCommand("Tell me about /sandbox")).toBeNull();
    expect(exactRunCommand("/unknown")).toBeNull();
  });

  test("filters the command menu from a leading slash token", () => {
    expect(
      matchingRunCommands("/dir", sandbox).map((command) => command.name),
    ).toEqual(["directory"]);
    expect(matchingRunCommands("hello /dir", sandbox)).toEqual([]);
  });

  test("only offers returning to the private workspace when away from it", () => {
    expect(names(sandbox)).toEqual(["directory", "link", "workspace"]);
    for (const workspace of [local, linked]) {
      expect(names(workspace)).toEqual([
        "directory",
        "link",
        "sandbox",
        "workspace",
      ]);
    }
    expect(matchingRunCommands("/sandbox", sandbox)).toEqual([]);
  });
});
