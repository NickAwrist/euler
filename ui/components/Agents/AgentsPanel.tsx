import { useEffect, useRef, useState } from "react";
import { isFinalAgent } from "../../../src/schemas/agents";
import { fetchAgent } from "../../persist/agents";
import { Button } from "../Button";
import { SegmentedControl } from "../SegmentedControl";
import { useAgents } from "./AgentContext";
import { AgentTaskCard } from "./AgentTaskCard";
export function AgentsPanel({
  sessionId,
  temporary,
  selected,
  onBack,
}: {
  sessionId: string;
  temporary: boolean;
  selected: string | null;
  onBack: () => void;
}) {
  const { agents, open } = useAgents();
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof fetchAgent>
  > | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"messages" | "activity">("messages");
  const lastSelected = useRef<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!selected) {
      if (lastSelected.current) rows.current.get(lastSelected.current)?.focus();
      return;
    }
    lastSelected.current = selected;
    let disposed = false;
    setDetail(null);
    setError("");
    const refresh = () =>
      void fetchAgent(sessionId, selected, temporary)
        .then((value) => {
          if (!disposed) setDetail(value);
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, temporary, selected]);
  const agent = agents.find((a) => a.id === selected);
  const list = agents
    .filter((a) => a.kind !== "main")
    .sort(
      (a, b) =>
        Number(isFinalAgent(a)) - Number(isFinalAgent(b)) ||
        b.createdAt - a.createdAt,
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" aria-label="Agents">
      {selected && (
        <Button variant="ghost" onClick={onBack}>
          Back to agents
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {agent ? (
        <>
          <AgentTaskCard agent={agent} />
          <SegmentedControl
            label="Agent detail"
            value={tab}
            onChange={setTab}
            options={[
              { value: "messages", label: "Messages" },
              { value: "activity", label: "Activity" },
            ]}
          />
          {tab === "messages"
            ? detail?.messages.map((message) => (
                <article
                  key={message.id}
                  className="my-3 rounded-lg border border-border-subtle p-3 text-sm"
                >
                  <p className="text-muted-foreground">
                    {message.sender === agent.id
                      ? agent.title
                      : message.sender === "runtime"
                        ? "Runtime"
                        : "Euler"}{" "}
                    · {message.kind} ·{" "}
                    {message.wakes ? "Wakes recipient" : "No wake"}
                    {message.deliveredAt === null
                      ? message.held
                        ? " · Held"
                        : " · Queued"
                      : " · Delivered"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </article>
              ))
            : detail?.agent.steps.map((step, index) => (
                <pre
                  key={`${index}:${step.startedAt}`}
                  className="my-3 whitespace-pre-wrap break-words text-xs"
                >
                  {String(step.toolName ?? step.kind)} · {String(step.status)}
                  {"\n"}
                  {String(step.result ?? "")}
                </pre>
              ))}
        </>
      ) : list.length ? (
        list.map((item) => (
          <div key={item.id} className="mb-4">
            <Button
              variant="ghost"
              ref={(node) => {
                if (node) rows.current.set(item.id, node);
                else rows.current.delete(item.id);
              }}
              onClick={() => open(item.id)}
            >
              {item.title}
            </Button>
            <AgentTaskCard agent={item} />
            <p className="text-xs text-muted-foreground">
              {Math.round(
                ((item.endedAt ?? Date.now()) - item.createdAt) / 1000,
              )}
              s · {item.activity}
            </p>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No background agents in this chat.
        </p>
      )}
    </div>
  );
}
