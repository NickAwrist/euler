import { z } from "zod";
export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["directory", "file"]),
});
export const DirectoryListingSchema = z.object({
  entries: z.array(DirectoryEntrySchema),
});
export const ImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);
export const FilePreviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), path: z.string(), content: z.string() }),
  z.object({
    kind: z.literal("image"),
    path: z.string(),
    mediaType: ImageMediaTypeSchema,
    data: z.string(),
  }),
]);
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
export type FilePreview = z.infer<typeof FilePreviewSchema>;
