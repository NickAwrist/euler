import { ArrowLeft, Bot, PanelRightClose, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../../ui/components/IconButton";
import { SegmentedControl } from "../../../ui/components/SegmentedControl";
import {
  type MockAgentStatus,
  agentStatusLabels,
} from "../shared/AgentTaskCard";

export type InboxEntry = {
  from: "Euler" | "Research agent" | "Runtime";
  kind: "Task" | "Progress" | "Question" | "Reply" | "Result";
  wakes: boolean;
  text: string;
  /** Stored but not yet delivered at the recipient's step boundary. */
  queued?: boolean;
};

export type MockAgent = {
  id: string;
  title: string;
  status: MockAgentStatus;
  elapsed: string;
  activity: string;
  inbox: InboxEntry[];
  steps: string[];
};

type Props = {
  agents: MockAgent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStop: (id: string) => void;
  onClose: () => void;
};

const live = (status: MockAgentStatus) =>
  status === "running" || status === "waiting";

/** Agents view of the artifact sidebar: a list, then one agent's detail. */
export function AgentsPanel({
  agents,
  selectedId,
  onSelect,
  onStop,
  onClose,
}: Props) {
  const [view, setView] = useState<"files" | "agents">("agents");
  const [tab, setTab] = useState<"messages" | "activity">("messages");
  const panel = useRef<HTMLElement>(null);
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const liveCount = agents.filter((agent) => live(agent.status)).length;
  const returnTo = useRef<string | null>(null);

  // Back returns focus to the row that opened the detail view.
  useEffect(() => {
    if (selectedId !== null || !returnTo.current) return;
    panel.current
      ?.querySelector<HTMLElement>(`[data-agent-id="${returnTo.current}"]`)
      ?.focus();
    returnTo.current = null;
  }, [selectedId]);

  // Mirrors ArtifactSidebar: focus moves in on open and back out on close.
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="mock-side-panel"
      aria-label="Artifacts"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="mock-panel-header">
        <SegmentedControl
          label="Sidebar view"
          value={view}
          onChange={setView}
          options={[
            { value: "files", label: "Files" },
            {
              value: "agents",
              label: liveCount ? `Agents (${liveCount})` : "Agents",
            },
          ]}
        />
        <IconButton
          icon={PanelRightClose}
          label="Close sidebar"
          variant="ghost"
          onClick={onClose}
        />
      </header>
      {view === "files" ? (
        <p className="mock-panel-empty">
          The existing file tree. Unchanged by this proposal.
        </p>
      ) : selected ? (
        <section className="mock-agent-detail" aria-label={selected.title}>
          <div className="mock-agent-detail-head">
            <IconButton
              icon={ArrowLeft}
              label="All agents"
              variant="ghost"
              size="sm"
              onClick={() => {
                returnTo.current = selected.id;
                onSelect(null);
              }}
            />
            <div>
              <h2>{selected.title}</h2>
              <p>
                Research agent · {selected.elapsed} · started by Euler at 14:02
              </p>
            </div>
            <span className="mock-task-status" data-status={selected.status}>
              {agentStatusLabels[selected.status]}
            </span>
            {live(selected.status) && (
              <IconButton
                icon={Square}
                label="Stop research agent"
                variant="ghost"
                size="sm"
                onClick={() => onStop(selected.id)}
              />
            )}
          </div>
          <p className="mock-agent-activity">{selected.activity}</p>
          <SegmentedControl
            label="Agent detail view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "messages", label: "Messages" },
              { value: "activity", label: "Activity" },
            ]}
          />
          {tab === "messages" ? (
            <ol className="mock-inbox" aria-label="Agent messages">
              {selected.inbox.map((entry) => (
                <li key={`${entry.kind}-${entry.text}`} data-from={entry.from}>
                  <p>
                    <strong>{entry.from}</strong> →{" "}
                    {entry.from === "Euler" ? "Research agent" : "Euler"} ·{" "}
                    {entry.kind}
                    {!entry.wakes && <span> · does not wake Euler</span>}
                    {entry.queued && (
                      <span className="mock-inbox-queued">
                        {" "}
                        · queued for Euler's next step
                      </span>
                    )}
                  </p>
                  <p>{entry.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="mock-steps" aria-label="Agent activity">
              {selected.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <ul className="mock-agent-list" aria-label="Agents in this chat">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                className="mock-agent-row"
                data-agent-id={agent.id}
                onClick={() => onSelect(agent.id)}
              >
                <Bot size={16} />
                <span>
                  {agent.title}
                  <small>
                    Research agent · {agent.elapsed} · {agent.activity}
                  </small>
                </span>
                <span className="mock-task-status" data-status={agent.status}>
                  {agentStatusLabels[agent.status]}
                </span>
              </button>
              {live(agent.status) && (
                <IconButton
                  icon={Square}
                  label={`Stop ${agent.title}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onStop(agent.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
