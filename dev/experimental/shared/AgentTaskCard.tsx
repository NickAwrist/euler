import { Bot, Globe, PanelRightOpen, Square } from "lucide-react";
import { IconButton } from "../../../ui/components/IconButton";

export type MockAgentStatus =
  | "running"
  | "waiting"
  | "needs-you"
  | "completed"
  | "cancelled";

export const agentStatusLabels: Record<MockAgentStatus, string> = {
  running: "Running",
  waiting: "Waiting for Euler",
  "needs-you": "Needs you",
  completed: "Completed",
  cancelled: "Cancelled",
};

type Props = {
  kind: "general" | "browser";
  title: string;
  status: MockAgentStatus;
  onStop?: () => void;
  onDetails?: () => void;
};

/**
 * One-line agent status in the transcript. Everything beyond name, status,
 * and controls lives in the Agents panel.
 */
export function AgentTaskCard({
  kind,
  title,
  status,
  onStop,
  onDetails,
}: Props) {
  const name = kind === "browser" ? "Browser agent" : "Research agent";
  const live = status === "running" || status === "waiting";
  return (
    <section className="mock-task" aria-label={name}>
      {kind === "browser" ? <Globe size={15} /> : <Bot size={15} />}
      <span className="mock-task-title" title={`${name}: ${title}`}>
        {title}
      </span>
      <span className="mock-task-status" data-status={status}>
        {agentStatusLabels[status]}
      </span>
      {onDetails && (
        <IconButton
          icon={PanelRightOpen}
          label={`${name} details`}
          variant="ghost"
          size="sm"
          onClick={onDetails}
        />
      )}
      {live && onStop && (
        <IconButton
          icon={Square}
          label={`Stop ${name.toLowerCase()}`}
          variant="ghost"
          size="sm"
          onClick={onStop}
        />
      )}
    </section>
  );
}
