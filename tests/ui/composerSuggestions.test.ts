import { expect, test } from "bun:test";
import {
  type ComposerSuggestionContext,
  collectComposerSuggestions,
  completeToolToken,
  composerSuggestionSources,
  findActiveToolToken,
} from "../../ui/components/composerSuggestions";

test("tool references work inline without completing paths or URLs", () => {
  expect(findActiveToolToken("Use /echo", 9)).toEqual({
    start: 4,
    end: 9,
    query: "echo",
  });
  expect(findActiveToolToken("/", 1)?.query).toBe("");
  for (const value of [
    "https://example",
    "src/file",
    "/tmp/file",
    "Use /echo now",
  ]) {
    expect(findActiveToolToken(value, value.length)).toBeNull();
  }
});

test("completion replaces the full token and preserves surrounding text", () => {
  const input = "Use /mcp__old then continue";
  const token = findActiveToolToken(input, 8)!;
  expect(completeToolToken(input, token, "mcp__test__echo")).toEqual({
    value: "Use /mcp__test__echo then continue",
    caret: 20,
  });
  expect(
    completeToolToken("/echo", { start: 0, end: 5 }, "mcp__test__echo"),
  ).toEqual({
    value: "/mcp__test__echo ",
    caret: 17,
  });
});

test("sources share a picker while keeping command and tool selection separate", () => {
  const completions: string[] = [];
  const commands: string[] = [];
  const context: ComposerSuggestionContext = {
    input: "/",
    workspace: { kind: "sandbox" },
    busy: false,
    skills: [],
    tools: [{ name: "mcp__test__echo", description: "Echo text" }],
    skillToken: null,
    toolToken: findActiveToolToken("/", 1),
    complete: ({ value }) => completions.push(value),
    runCommand: (name) => commands.push(name),
  };
  const options = collectComposerSuggestions(
    composerSuggestionSources,
    context,
  );
  expect(options.map(({ label }) => label)).toEqual([
    "/directory",
    "/link",
    "/workspace",
    "/mcp__test__echo",
  ]);
  options[0]!.select();
  options.at(-1)!.select();
  expect(commands).toEqual(["directory"]);
  expect(completions).toEqual(["/mcp__test__echo "]);
  expect(
    collectComposerSuggestions(composerSuggestionSources, {
      ...context,
      busy: true,
    }).map(({ label }) => label),
  ).toEqual(["/mcp__test__echo"]);
});
