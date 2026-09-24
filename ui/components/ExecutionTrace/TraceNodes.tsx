import { Bot, Wrench } from "lucide-react";
import { MAIN_AGENT_NAME } from "../../../src/agents/agentNames";
import { cx, debugBlock, eyebrowText } from "../../styles";
import type { MessageStep, SubagentRun } from "../../types";
import { traceStepsForDisplay } from "./normalizeTrace";

function traceStepKey(step: MessageStep): string {
  return [
    step.kind,
    step.status,
    step.toolName,
    step.agentName,
    step.result,
    step.error,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(":");
}

function TraceStepsInner({ steps }: { steps: MessageStep[] }) {
  return (
    <div className="border-l border-border-subtle/80 pl-3">
      {steps.map((step, index) => (
        <div
          key={traceStepKey(step)}
          className={
            index > 0 ? "mt-3 border-t border-border-subtle/60 pt-3" : ""
          }
        >
          <TraceStepBody step={step} showIndex={false} />
        </div>
      ))}
    </div>
  );
}

function TraceSubagentPanel({ run }: { run: SubagentRun }) {
  const steps = traceStepsForDisplay(run.steps ?? []);
  if (steps.length === 0) return null;

  return (
    <details
      className="group mt-3 rounded-lg border border-border-subtle bg-muted/25 open:bg-muted/35"
      open={false}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[0.8125rem] font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-open:bg-accent-soft group-open:text-accent">
          <Bot size={15} />
        </span>
        <span className="min-w-0 flex-1">
          Subagent trace
          {run.agentName ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              - {run.agentName}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[0.6875rem] font-normal text-muted-foreground">
          {steps.length} steps
        </span>
      </summary>
      <div className="border-t border-border-subtle px-2 pb-3 pt-1">
        {run.prompt ? (
          <div className="mb-3 px-2 pt-2">
            <div className={eyebrowText}>Prompt</div>
            <pre
              className={cx(
                debugBlock,
                "mt-1.5 max-h-40 overflow-auto text-[0.8125rem] leading-[1.5] text-muted-foreground",
              )}
            >
              {run.prompt}
            </pre>
          </div>
        ) : null}
        <TraceStepsInner steps={steps} />
      </div>
    </details>
  );
}

export function TraceStepBody({
  step,
  showIndex,
  stepNumber,
  streamingThinking,
}: {
  step: MessageStep;
  showIndex: boolean;
  stepNumber?: number;
  streamingThinking?: string;
}) {
  const thinkingText =
    step.thinking || (step.status === "running" ? streamingThinking : "") || "";

  return (
    <div
      className={cx(
        showIndex && "border-b border-border-subtle py-[14px] last:border-b-0",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {showIndex && stepNumber != null ? (
          <span className="flex size-[26px] items-center justify-center rounded-md bg-muted text-[0.6875rem] font-semibold text-muted-foreground">
            {stepNumber}
          </span>
        ) : null}
        <span className="rounded-md bg-muted px-2 py-[3px] text-[0.6875rem] font-medium text-muted-foreground">
          {step.kind}
        </span>
        {step.toolName && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-[3px] text-[0.6875rem] font-medium text-muted-foreground">
            <Wrench size={12} />
            {step.toolName}
          </span>
        )}
        {step.agentName && step.agentName !== MAIN_AGENT_NAME ? (
          <span className="rounded-md border border-border-subtle bg-transparent px-2 py-[3px] text-[0.6875rem] font-medium text-muted-foreground">
            {step.agentName}
          </span>
        ) : null}
        {step.status && step.status !== "done" ? (
          <span className="rounded-md bg-muted px-2 py-[3px] text-[0.6875rem] text-muted-foreground">
            {step.status}
          </span>
        ) : null}
      </div>

      {thinkingText ? (
        <div className="mt-2">
          <div className={eyebrowText}>Thinking</div>
          <pre
            className={cx(
              debugBlock,
              "mt-1.5 max-h-[min(40vh,20rem)] overflow-auto text-[0.8125rem] leading-[1.6] text-muted-foreground",
            )}
          >
            {thinkingText}
          </pre>
        </div>
      ) : null}

      {step.args != null ? (
        <div className="mt-2.5">
          <div className={eyebrowText}>Arguments</div>
          <pre
            className={cx(
              debugBlock,
              "mt-1.5 text-[0.8125rem] leading-[1.5] text-muted-foreground",
            )}
          >
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </div>
      ) : null}

      {step.result ? (
        <div className="mt-2.5">
          <div className={eyebrowText}>Result</div>
          <pre
            className={cx(
              debugBlock,
              "mt-1.5 text-[0.8125rem] leading-[1.5] text-muted-foreground",
            )}
          >
            {step.result}
          </pre>
        </div>
      ) : null}

      {step.error ? (
        <div className="mt-2.5">
          <div className={eyebrowText}>Error</div>
          <div className="mt-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[0.8125rem] text-red-200">
            {step.error}
          </div>
        </div>
      ) : null}

      {step.childRun ? <TraceSubagentPanel run={step.childRun} /> : null}
    </div>
  );
}
