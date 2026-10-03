import { z } from "zod";
import { AgentSchema, InboxMessageSchema } from "../../src/schemas/agents";
import { ActivationSchema } from "../../src/schemas/events";
import { JobSchema } from "../../src/schemas/jobs";
import { WireMessageSchema, WireStepSchema } from "../../src/schemas/run";
import { apiJson, apiVoid } from "../lib/api";
export const runtimePath = (id: string) =>
  `/api/sessions/${encodeURIComponent(id)}`;
export const RuntimeSnapshotSchema = z.object({
  sequence: z.number(),
  agents: z.array(AgentSchema),
  jobs: z.array(JobSchema).default([]),
  activation: ActivationSchema.nullable(),
  queued: z.array(InboxMessageSchema),
  held: z.boolean(),
  history: z.array(WireMessageSchema).optional(),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;
export async function fetchRuntime(id: string) {
  return RuntimeSnapshotSchema.parse(
    await apiJson(`${runtimePath(id)}/runtime`),
  );
}
export function agentAction(id: string, action: string, json: unknown = {}) {
  return apiVoid(`${runtimePath(id)}/${action}`, {
    method: "POST",
    json,
  });
}
export async function fetchAgent(id: string, agentId: string) {
  return z
    .object({
      agent: AgentSchema,
      steps: z.array(WireStepSchema),
      messages: z.array(InboxMessageSchema),
    })
    .parse(
      await apiJson(`${runtimePath(id)}/agents/${encodeURIComponent(agentId)}`),
    );
}
export function cancelAgent(id: string, agentId: string) {
  return agentAction(id, `agents/${encodeURIComponent(agentId)}/cancel`);
}
export function removeQueuedMessage(id: string, messageId: number) {
  return apiVoid(`${runtimePath(id)}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export function editQueuedMessage(
  id: string,
  messageId: number,
  content: string,
) {
  return apiVoid(`${runtimePath(id)}/messages/${messageId}`, {
    method: "PATCH",
    json: { content },
  });
}
