import { z } from "zod";
import { AgentSchema, InboxMessageSchema } from "../../src/schemas/agents";
import { ActivationSchema } from "../../src/schemas/events";
import { WireMessageSchema } from "../../src/schemas/run";
import { apiJson, apiVoid } from "../lib/api";
export const runtimePath = (id: string, temporary = false) =>
  `/api/${temporary ? "temporary-sessions" : "sessions"}/${encodeURIComponent(id)}`;
export const RuntimeSnapshotSchema = z.object({
  sequence: z.number(),
  agents: z.array(AgentSchema),
  activation: ActivationSchema.nullable(),
  queued: z.array(InboxMessageSchema),
  held: z.boolean(),
  history: z.array(WireMessageSchema).optional(),
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;
export async function fetchRuntime(id: string, temporary = false) {
  return RuntimeSnapshotSchema.parse(
    await apiJson(`${runtimePath(id, temporary)}/runtime`),
  );
}
export function agentAction(
  id: string,
  action: string,
  json: unknown = {},
  temporary = false,
) {
  return apiVoid(`${runtimePath(id, temporary)}/${action}`, {
    method: "POST",
    json,
  });
}
export async function fetchAgent(
  id: string,
  agentId: string,
  temporary = false,
) {
  return z
    .object({ agent: AgentSchema, messages: z.array(InboxMessageSchema) })
    .parse(
      await apiJson(
        `${runtimePath(id, temporary)}/agents/${encodeURIComponent(agentId)}`,
      ),
    );
}
export function removeQueuedMessage(
  id: string,
  messageId: number,
  temporary = false,
) {
  return apiVoid(`${runtimePath(id, temporary)}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export function editQueuedMessage(
  id: string,
  messageId: number,
  content: string,
  temporary = false,
) {
  return apiVoid(`${runtimePath(id, temporary)}/messages/${messageId}`, {
    method: "PATCH",
    json: { content },
  });
}
