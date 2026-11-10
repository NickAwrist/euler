import { SUBAGENT_NAME } from "../../../src/agents/agentNames";
import { Step_Kind } from "../../../src/gen/euler/v1/steps_pb";
import type { Step } from "../../types";

function startCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getLiveStepMeta(
  step: Step | null,
  count: number,
  streamingContent: string,
  streamingThinking: string,
) {
  const isResponding = streamingContent.length > 0;
  const isThinking = streamingThinking.length > 0;

  if (!step) {
    return {
      label: "Running",
      detail: `${count} step${count === 1 ? "" : "s"}`,
    };
  }

  const toolName = step.toolName ? startCase(step.toolName) : null;
  if (step.kind === Step_Kind.TOOL_CALL) {
    return {
      label: "Tool",
      detail: toolName,
    };
  }

  if (step.kind === Step_Kind.LLM_CALL && step.agentName === SUBAGENT_NAME) {
    return {
      label: "Agent",
      detail: "Subagent",
    };
  }

  if (step.kind === Step_Kind.COMPLETE) {
    return {
      label: "Writing",
      detail: null,
    };
  }

  if (step.kind === Step_Kind.ERROR) {
    return {
      label: "Error",
      detail: null,
    };
  }

  return {
    label: isResponding
      ? "Responding"
      : isThinking
        ? "Thinking"
        : "Initializing",
    detail: null,
  };
}
