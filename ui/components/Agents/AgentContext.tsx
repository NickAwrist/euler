import { createContext, useContext } from "react";
import type { Agent } from "../../../src/gen/euler/v1/agent_pb";
import type { AgentPhase } from "../../types";
export const AgentContext = createContext<{
  agents: Agent[];
  phases: Readonly<Record<string, AgentPhase>>;
  open: (id: string) => void;
  stop: (id: string) => Promise<void>;
}>({ agents: [], phases: {}, open: () => {}, stop: async () => {} });
export const useAgents = () => useContext(AgentContext);
