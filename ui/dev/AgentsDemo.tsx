import { useState } from "react";
import type { Agent } from "../../src/schemas/agents";
import { AgentContext } from "../components/Agents/AgentContext";
import { AgentTraceModal } from "../components/Agents/AgentTraceModal";
import { AgentsList } from "../components/Agents/AgentsList";

const base: Agent = {
  id: "interrupted",
  sessionId: "fixture",
  ownerUuid: "fixture",
  parentId: "main",
  kind: "general",
  title: "Research",
  status: "idle",
  model: "openrouter:openai/gpt-5.6-terra",
  spawnPosition: 1,
  createdAt: 1,
  endedAt: null,
  activity: "",
  steps: [],
  held: false,
  interruption: "Interrupted by server restart. Ready for new instructions.",
};
export default function AgentsDemo() {
  const [agents, setAgents] = useState<Agent[]>([
    base,
    {
      ...base,
      id: "failed",
      title: "Local analysis",
      model: "qwen3:8b",
      status: "failed",
      interruption: undefined,
      activity: "Model unavailable",
      endedAt: 2,
    },
    {
      ...base,
      id: "working",
      title: "Long research",
      status: "running",
      interruption: undefined,
    },
  ]);
  const [selected, setSelected] = useState<string | null>(null);
  const agent = agents.find((a) => a.id === selected);
  return (
    <AgentContext.Provider
      value={{
        agents,
        open: setSelected,
        stop: async (id) =>
          setAgents((current) =>
            current.map((a) =>
              a.id === id
                ? { ...a, interruption: undefined, status: "completed" }
                : a,
            ),
          ),
      }}
    >
      <main className="mx-auto max-w-md py-6">
        <AgentsList />
        {agent && (
          <AgentTraceModal
            sessionId="fixture"
            temporary={false}
            agent={agent}
            onClose={() => setSelected(null)}
          />
        )}
      </main>
    </AgentContext.Provider>
  );
}
