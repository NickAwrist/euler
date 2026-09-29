import { expect, test } from "bun:test";
import { missingToolResults } from "../../src/agents/toolResults";

const call = (id?: string) => ({
  ...(id ? { id } : {}),
  function: { name: "bash", arguments: {} },
});

test("unanswered calls get results, including Ollama calls without IDs", () => {
  const history = [
    { role: "user", content: "Run both" },
    { role: "assistant", content: "", tool_calls: [call(), call()] },
    { role: "tool", content: "first done" },
  ];
  expect(missingToolResults(history, "Interrupted")).toEqual([
    { role: "tool", content: "Interrupted" },
  ]);
  expect(
    missingToolResults(
      [{ role: "assistant", tool_calls: [call("a")] }],
      "Interrupted",
    ),
  ).toEqual([{ role: "tool", content: "Interrupted", tool_call_id: "a" }]);
  expect(missingToolResults([...history, history[2]!], "Interrupted")).toEqual(
    [],
  );
});
