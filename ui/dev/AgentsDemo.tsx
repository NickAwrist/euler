import { useState } from "react";
import type { Agent } from "../../src/schemas/agents";
import { AgentAvatar } from "../components/Agents/AgentAvatar";
import { AgentContext } from "../components/Agents/AgentContext";
import { AgentTraceModal } from "../components/Agents/AgentTraceModal";
import { AgentsList } from "../components/Agents/AgentsList";
import type { AgentPhase } from "../types";

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
  held: false,
  interruption: "Interrupted by server restart. Ready for new instructions.",
};
const gallery = Array.from({ length: 8 }, (_, i) => ({
  ...base,
  id: `gallery-${i}`,
  createdAt: i,
  interruption: undefined,
}));
const galleryStates: Array<[string, AgentPhase | null]> = [
  ["Ready", null],
  ["Thinking", "thinking"],
  ["Using a tool", "tool"],
  ["Responding", "responding"],
];
function AvatarGallery() {
  return (
    <section
      aria-label="Avatar states"
      className="mt-8 grid grid-cols-[auto_repeat(8,1fr)] items-center gap-3 text-xs text-muted-foreground"
    >
      {galleryStates.map(([label, phase]) => (
        <AgentContext.Provider
          key={label}
          value={{
            agents: gallery.map((a) => ({
              ...a,
              status: phase ? "running" : "idle",
            })),
            phases: phase
              ? Object.fromEntries(gallery.map((a) => [a.id, phase]))
              : {},
            open: () => {},
            stop: async () => {},
          }}
        >
          <span>{label}</span>
          {gallery.map((a) => (
            <AgentAvatar
              key={a.id}
              agent={{ ...a, status: phase ? "running" : "idle" }}
              size={28}
            />
          ))}
        </AgentContext.Provider>
      ))}
    </section>
  );
}
export default function AgentsDemo() {
  const [agents, setAgents] = useState<Agent[]>([
    base,
    {
      ...base,
      id: "errored",
      title: "Local analysis",
      model: "qwen3:8b",
      interruption: "Model unavailable",
      activity: "Model unavailable",
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
        phases: {},
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
        <AvatarGallery />
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
