import { createContext, useContext } from "react";
import type { Agent } from "../../../src/schemas/agents";
export const AgentContext = createContext<{
  agents: Agent[];
  open: (id: string) => void;
  stop: (id: string) => Promise<void>;
}>({ agents: [], open: () => {}, stop: async () => {} });
export const useAgents = () => useContext(AgentContext);
