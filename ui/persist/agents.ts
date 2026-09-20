import type { AgentData, AgentWriteBody } from "../../src/schemas/agents";
import { apiJson, apiVoid, globalApiJson } from "../lib/api";

export type { AgentData, AgentWriteBody };

export async function fetchAgents(): Promise<AgentData[]> {
  const data = await apiJson<{ agents?: AgentData[] }>("/api/agents", {
    errorMessage: "Failed to fetch agents",
  });
  return data.agents ?? [];
}

export function createAgentApi(body: AgentWriteBody): Promise<AgentData> {
  return apiJson<AgentData>("/api/agents", {
    method: "POST",
    json: body,
    errorMessage: "Failed to create agent",
  });
}

export function updateAgentApi(
  id: string,
  body: AgentWriteBody,
): Promise<void> {
  return apiVoid(`/api/agents/${id}`, {
    method: "PUT",
    json: body,
    errorMessage: "Failed to update agent",
  });
}

export function deleteAgentApi(id: string): Promise<void> {
  return apiVoid(`/api/agents/${id}`, {
    method: "DELETE",
    errorMessage: "Failed to delete agent",
  });
}

export async function fetchBuiltinTools(): Promise<string[]> {
  const data = await globalApiJson<{ tools?: string[] }>("/api/tools", {
    errorMessage: "Failed to fetch tools",
  });
  return data.tools ?? [];
}

export async function fetchDefaultRunAgent(): Promise<string> {
  const data = await apiJson<{ agentName?: unknown }>(
    "/api/settings/default-run-agent",
    { errorMessage: "Failed to fetch default agent" },
  );
  return typeof data.agentName === "string" ? data.agentName : "general_agent";
}

export async function putDefaultRunAgentApi(
  agentName: string,
): Promise<string> {
  const data = await apiJson<{ agentName?: unknown }>(
    "/api/settings/default-run-agent",
    {
      method: "PUT",
      json: { agentName },
      errorMessage: "Failed to update default agent",
    },
  );
  return typeof data.agentName === "string" ? data.agentName : agentName;
}
