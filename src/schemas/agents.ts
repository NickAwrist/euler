import { z } from "zod";
import { MAX_IMAGES_PER_MESSAGE } from "../attachments/types";
import { MessageVersionSchema, RunMetadataSchema, WireStepSchema } from "./run";

export const AgentStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "idle",
  "completed",
  "failed",
  "cancelled",
]);
export const AgentSchema = z.object({
  held: z.boolean().default(false),
  id: z.string(),
  sessionId: z.string(),
  ownerUuid: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["main", "general"]),
  title: z.string(),
  status: AgentStatusSchema,
  model: z.string(),
  spawnPosition: z.number(),
  createdAt: z.number(),
  endedAt: z.number().nullable(),
  activity: z.string(),
  interruption: z.string().optional(),
  steps: z.array(WireStepSchema),
});
export type Agent = z.infer<typeof AgentSchema>;
export const InboxMessageSchema = z.object({
  id: z.number(),
  agentId: z.string(),
  sender: z.string(),
  kind: z.enum([
    "user",
    "task",
    "message",
    "question",
    "progress",
    "result",
    "failure",
    "status",
    "control",
  ]),
  content: z.string(),
  wakes: z.boolean(),
  createdAt: z.number(),
  deliveredAt: z.number().nullable(),
  held: z.boolean().default(false),
  attachmentIds: z.array(z.string()).default([]),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;
export const SendMessageSchema = z
  .object({
    content: z.string().trim().min(1),
    attachmentIds: z.array(z.uuid()).max(MAX_IMAGES_PER_MESSAGE).default([]),
    model: z.string().optional(),
    reasoningEffort: z.string().optional(),
    metadata: RunMetadataSchema.optional(),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export const EditQueuedMessageSchema = z
  .object({ content: z.string().trim().min(1) })
  .strict();
export const RewindSchema = z
  .object({
    position: z.number().int().nonnegative(),
    content: z.string().trim().min(1).optional(),
    versions: z.array(MessageVersionSchema).optional(),
  })
  .strict();
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export const FINAL_STATUSES: readonly AgentStatus[] = [
  "completed",
  "failed",
  "cancelled",
];
/** Queued, running, or blocked on a reply. A ready subagent is `idle`. */
export const WORKING_STATUSES: readonly AgentStatus[] = [
  "queued",
  "running",
  "waiting",
];
export const isFinalAgent = (agent: Pick<Agent, "status">) =>
  FINAL_STATUSES.includes(agent.status);
export const isWorkingAgent = (agent: Pick<Agent, "status">) =>
  WORKING_STATUSES.includes(agent.status);
