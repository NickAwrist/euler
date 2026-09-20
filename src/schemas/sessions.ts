import { z } from "zod";
import { WireMessageSchema } from "./run";

export const SessionWorkspaceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sandbox"),
  }),
  z.object({
    kind: z.literal("local"),
    path: z.string(),
    label: z.string(),
  }),
]);

export type SessionWorkspace = z.infer<typeof SessionWorkspaceSchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  preview: z.string(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionSummaryListSchema = z.object({
  sessions: z.array(SessionSummarySchema),
});

export const StoredRunSessionSchema = z.object({
  id: z.string(),
  createdAt: z.number().default(0),
  updatedAt: z.number().default(0),
  customTitle: z.string().nullable().optional(),
  history: z.array(WireMessageSchema).default([]),
  modelMessages: z
    .array(z.record(z.string(), z.unknown()))
    .nullable()
    .optional(),
  model: z.string().nullable().optional(),
  workspace: SessionWorkspaceSchema.default({ kind: "sandbox" }),
});

export type StoredRunSession = z.infer<typeof StoredRunSessionSchema>;

export const CreateSessionBodySchema = z.object({
  model: z.string().trim().nullable().optional(),
});

export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;

export const PatchSessionBodySchema = z.object({
  customTitle: z.string().trim().nullable().optional(),
  model: z.string().trim().nullable().optional(),
  modelMessages: z
    .array(z.record(z.string(), z.unknown()))
    .nullable()
    .optional(),
  history: z.array(WireMessageSchema).optional(),
});

export type PatchSessionBody = z.infer<typeof PatchSessionBodySchema>;

export const RevealFileSchema = z.object({
  path: z.string().trim().min(1, "path is required"),
});

export type RevealFileBody = z.infer<typeof RevealFileSchema>;
