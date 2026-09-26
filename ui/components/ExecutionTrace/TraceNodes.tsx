import { Bot, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import { MAIN_AGENT_NAME } from "../../../src/agents/agentNames";
import { formatDuration } from "../../lib/formatDuration";
import { cx, debugBlock, eyebrowText } from "../../styles";
import type { MessageStep, SubagentRun } from "../../types";
import { traceStepsForDisplay } from "./normalizeTrace";
import {
  type TimelineSpan,
  traceStepDurationMs,
  traceStepLabel,
} from "./traceDisplay";

const LONG_SECTION_LINES = 12;
const LONG_SECTION_CHARS = 800;

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

/** Labeled trace text that starts collapsed when it is long. */
function TraceSection({ label, text }: { label: string; text: string }) {
  const lineCount = text.split("\n").length;
  const [initiallyOpen] = useState(
    () => lineCount <= LONG_SECTION_LINES && text.length <= LONG_SECTION_CHARS,
  );

  return (
    <details open={initiallyOpen} className="group/section mt-2.5">
      <summary
        className={cx(
          eyebrowText,
          "flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm hover:text-foreground marker:content-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight
          size={12}
          aria-hidden
          className="transition-transform duration-150 group-open/section:rotate-90"
        />
        {label}
        {!initiallyOpen && (
          <span className="font-normal normal-case tracking-normal">
            · {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        )}
      </summary>
      <pre
        className={cx(
          debugBlock,
          "mt-1.5 max-h-[min(40vh,20rem)] overflow-auto text-[0.8125rem] leading-[1.5] text-muted-foreground",
        )}
      >
        {text}
      </pre>
    </details>
  );
}

export function TraceStepBody({
  step,
  showIndex,
  stepNumber,
  streamingThinking,
  timeline,
}: {
  step: MessageStep;
  showIndex: boolean;
  stepNumber?: number;
  streamingThinking?: string;
  timeline?: TimelineSpan;
}) {
  const thinkingText =
    step.thinking || (step.status === "running" ? streamingThinking : "") || "";
  const durationMs = traceStepDurationMs(step);

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
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-[3px] text-[0.6875rem] font-medium text-foreground">
          {step.kind === "tool_call" && <Wrench size={12} aria-hidden />}
          {traceStepLabel(step)}
        </span>
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
        {durationMs !== undefined && (
          <span className="ml-auto text-[0.6875rem] tabular-nums text-muted-foreground">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {timeline && (
        <div className="relative mt-2 h-1 rounded-full bg-muted/60" aria-hidden>
          <div
            className={cx(
              "absolute inset-y-0 min-w-1 rounded-full",
              step.status === "error" ? "bg-red-400/70" : "bg-accent/70",
            )}
            style={{
              left: `${timeline.offset * 100}%`,
              width: `${timeline.width * 100}%`,
            }}
          />
        </div>
      )}

      {thinkingText ? (
        <TraceSection label="Thinking" text={thinkingText} />
      ) : null}

      {step.args != null ? (
        <TraceSection
          label="Arguments"
          text={JSON.stringify(step.args, null, 2)}
        />
      ) : null}

      {step.result ? <TraceSection label="Result" text={step.result} /> : null}

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
