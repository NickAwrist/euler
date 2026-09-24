import { describe, expect, test } from "bun:test";
import { MAIN_AGENT_NAME, SUBAGENT_NAME } from "../../src/agents/agentNames";
import { getLiveStepMeta } from "../../ui/components/RunArea/liveStepMeta";

const llmStep = {
  kind: "llm_call",
  status: "running",
  agentName: MAIN_AGENT_NAME,
};

describe("live step metadata", () => {
  test("distinguishes model initialization, reasoning, and response streaming", () => {
    expect(getLiveStepMeta(llmStep, 1, "", "").label).toBe("Initializing");
    expect(getLiveStepMeta(llmStep, 1, "", "Reasoning").label).toBe("Thinking");
    expect(getLiveStepMeta(llmStep, 1, "", " ").label).toBe("Thinking");
    expect(getLiveStepMeta(llmStep, 1, "Answer", "Reasoning").label).toBe(
      "Responding",
    );
  });

  test("identifies delegation from nested run data instead of tool naming", () => {
    const result = getLiveStepMeta(
      {
        kind: "tool_call",
        status: "running",
        toolName: "run_subagent",
        childRun: { agentName: SUBAGENT_NAME, steps: [] },
      },
      2,
      "",
      "",
    );

    expect(result.label).toBe("Agent");
  });

  test("labels subagent model calls but not the main agent's", () => {
    expect(
      getLiveStepMeta({ ...llmStep, agentName: SUBAGENT_NAME }, 3, "", ""),
    ).toEqual({ label: "Agent", detail: "Subagent" });
    expect(getLiveStepMeta(llmStep, 3, "", "").detail).toBeNull();
  });
});
