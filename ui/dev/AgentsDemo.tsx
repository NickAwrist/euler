import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { useState } from "react";
import {
  type Agent,
  AgentSchema,
  Agent_Kind,
  Agent_Status,
} from "../../src/gen/euler/v1/agent_pb";
import { AgentAvatar } from "../components/Agents/AgentAvatar";
import { AgentContext } from "../components/Agents/AgentContext";
import { AgentTraceModal } from "../components/Agents/AgentTraceModal";
import { AgentsList } from "../components/Agents/AgentsList";
import type { AgentPhase } from "../types";

const base: Agent = create(AgentSchema, {
  id: "interrupted",
  sessionId: "fixture",
  parentId: "main",
  kind: Agent_Kind.GENERAL,
  title: "Research",
  status: Agent_Status.IDLE,
  model: "openrouter:openai/gpt-5.6-terra",
  spawnPosition: 1,
  createdAt: timestampFromMs(1),
  activity: "",
  held: false,
  interruption: "Interrupted by server restart. Ready for new instructions.",
});
const gallery: Agent[] = Array.from({ length: 8 }, (_, i) => ({
  ...base,
  id: `gallery-${i}`,
  createdAt: timestampFromMs(i),
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
              status: phase ? Agent_Status.RUNNING : Agent_Status.IDLE,
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
              agent={{
                ...a,
                status: phase ? Agent_Status.RUNNING : Agent_Status.IDLE,
              }}
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
      status: Agent_Status.RUNNING,
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
                ? {
                    ...a,
                    interruption: undefined,
                    status: Agent_Status.COMPLETED,
                  }
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
            agent={agent}
            onClose={() => setSelected(null)}
          />
        )}
      </main>
    </AgentContext.Provider>
  );
}
