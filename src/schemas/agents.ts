import { z } from "zod";
import { OutputAttachmentSchema } from "../attachments/types";
import { type MessageVersion, RunMetadataSchema } from "./run";

export const AgentStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "idle",
  "completed",
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
    "control",
    "job",
  ]),
  content: z.string(),
  wakes: z.boolean(),
  createdAt: z.number(),
  deliveredAt: z.number().nullable(),
  held: z.boolean().default(false),
  attachmentIds: z.array(z.string()).default([]),
  attachments: z.array(OutputAttachmentSchema).default([]),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;
/** Composer settings sent with each turn the user starts. */
export const TurnSettingsSchema = z.object({
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  metadata: RunMetadataSchema.optional(),
});
export type TurnSettings = z.infer<typeof TurnSettingsSchema>;
export type SendMessageRequest = TurnSettings & {
  content: string;
  attachmentIds: string[];
};
export type RewindRequest = TurnSettings & {
  position: number;
  content?: string;
  versions?: MessageVersion[];
};
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export const FINAL_STATUSES: readonly AgentStatus[] = [
  "completed",
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
