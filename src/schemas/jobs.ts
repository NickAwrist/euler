import { z } from "zod";
import { OutputAttachmentSchema } from "../attachments/types";
import { ErrorDetailsSchema } from "./observability";
import { ToolContentSchema } from "./toolContent";
export const JobStatusSchema = z.enum([
  "starting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
export const JobSchema = z.object({
  id: z.string(),
  ownerUuid: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  tool: z.string(),
  description: z.string(),
  activationId: z.string(),
  spawnPosition: z.number().int().nonnegative().optional(),
  input: ToolContentSchema,
  status: JobStatusSchema,
  createdAt: z.number(),
  endedAt: z.number().nullable(),
  progress: ToolContentSchema.nullable(),
  output: ToolContentSchema.nullable(),
  metadata: ToolContentSchema.nullable(),
  outputTruncated: z.boolean(),
  result: z
    .object({
      text: z.string(),
      attachments: z.array(OutputAttachmentSchema).optional(),
      failed: z.boolean().optional(),
    })
    .optional(),
  error: ErrorDetailsSchema.optional(),
  notified: z.boolean(),
});
export type Job = z.infer<typeof JobSchema>;
export const activeJob = (job: Pick<Job, "status">) =>
  job.status === "starting" || job.status === "running";
