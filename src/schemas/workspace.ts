import { z } from "zod";

export const SelectDirectorySchema = z.object({
  path: z.string().trim().min(1).max(4096),
});

export const LinkWorkspaceSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export const WorkspaceFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
});

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

export const WorkspaceFilesResponseSchema = z.object({
  files: z.array(WorkspaceFileSchema),
});
