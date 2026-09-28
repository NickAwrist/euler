import { z } from "zod";
import { AgentSchema, InboxMessageSchema } from "./agents";
import { WireMessageSchema, WireStepSchema } from "./run";

export const ActivationSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  sessionId: z.string(),
  content: z.string(),
  thinking: z.string(),
  steps: z.array(WireStepSchema),
});
export type Activation = z.infer<typeof ActivationSchema>;
export const AgentEventSchema = z
  .object({
    sequence: z.number(),
    sessionId: z.string(),
    agentId: z.string(),
  })
  .and(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("activation_started"),
        activation: ActivationSchema,
      }),
      z.object({
        type: z.literal("delta"),
        activationId: z.string(),
        contentDelta: z.string(),
        thinkingDelta: z.string(),
      }),
      z.object({
        type: z.literal("step"),
        activationId: z.string(),
        /** The step's index in the activation's open segment. */
        position: z.number().int().nonnegative(),
        step: WireStepSchema,
      }),
      z.object({
        type: z.literal("activation_ended"),
        activationId: z.string(),
        outcome: z.enum(["done", "aborted", "error", "paused"]),
      }),
      z.object({
        type: z.literal("transcript_appended"),
        message: WireMessageSchema,
      }),
      z.object({ type: z.literal("agent_status"), agent: AgentSchema }),
      z.object({
        type: z.literal("inbox_queued"),
        messages: z.array(InboxMessageSchema),
      }),
      z.object({ type: z.literal("resync") }),
    ]),
  );
export type AgentEvent = z.infer<typeof AgentEventSchema>;
