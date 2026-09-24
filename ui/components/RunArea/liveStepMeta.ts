import { SUBAGENT_NAME } from "../../../src/agents/agentNames";
import type { MessageStep } from "../../types";

function startCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getLiveStepMeta(
  step: MessageStep | null,
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
  const isSubagentTool =
    step.kind === "tool_call" && step.childRun !== undefined;

  if (isSubagentTool) {
    return {
      label: "Agent",
      detail: toolName,
    };
  }

  if (step.kind === "tool_call") {
    return {
      label: "Tool",
      detail: toolName,
    };
  }

  if (step.kind === "llm_call" && step.agentName === SUBAGENT_NAME) {
    return {
      label: "Agent",
      detail: "Subagent",
    };
  }

  if (step.kind === "complete") {
    return {
      label: "Writing",
      detail: null,
    };
  }

  if (step.kind === "error") {
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
