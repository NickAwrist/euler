import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { MAIN_AGENT_NAME, SUBAGENT_NAME } from "../../src/agents/agentNames";
import {
  StepSchema,
  Step_Kind,
  Step_Status,
} from "../../src/gen/euler/v1/steps_pb";
import { getLiveStepMeta } from "../../ui/components/RunArea/liveStepMeta";

const llmStep = create(StepSchema, {
  kind: Step_Kind.LLM_CALL,
  status: Step_Status.RUNNING,
  agentName: MAIN_AGENT_NAME,
});

describe("live step metadata", () => {
  test("distinguishes model initialization, reasoning, and response streaming", () => {
    expect(getLiveStepMeta(llmStep, 1, "", "").label).toBe("Initializing");
    expect(getLiveStepMeta(llmStep, 1, "", "Reasoning").label).toBe("Thinking");
    expect(getLiveStepMeta(llmStep, 1, "", " ").label).toBe("Thinking");
    expect(getLiveStepMeta(llmStep, 1, "Answer", "Reasoning").label).toBe(
      "Responding",
    );
  });

  test("labels subagent model calls but not the main agent's", () => {
    expect(
      getLiveStepMeta({ ...llmStep, agentName: SUBAGENT_NAME }, 3, "", ""),
    ).toEqual({ label: "Agent", detail: "Subagent" });
    expect(getLiveStepMeta(llmStep, 3, "", "").detail).toBeNull();
  });
});
