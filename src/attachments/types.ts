import { z } from "zod";

export const ImageMimeType = {
  Png: "image/png",
  Jpeg: "image/jpeg",
  Webp: "image/webp",
  Gif: "image/gif",
} as const;

export type ImageMimeType = (typeof ImageMimeType)[keyof typeof ImageMimeType];

export const IMAGE_MIME_TYPES = [
  ImageMimeType.Png,
  ImageMimeType.Jpeg,
  ImageMimeType.Webp,
  ImageMimeType.Gif,
] as const;
export const ImageMimeTypeSchema = z.enum(IMAGE_MIME_TYPES);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;

export const ImageAttachmentSchema = z.object({
  id: z.uuid(),
  kind: z.literal("image"),
  name: z.string().min(1).max(255),
  mimeType: ImageMimeTypeSchema,
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

export const WorkspaceFileAttachmentSchema = z.object({
  id: z.uuid(),
  kind: z.literal("file"),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  path: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceKind: z.enum(["sandbox", "local"]),
  temporary: z.boolean(),
});

export const COMFYUI_VIEW_PREFIX = "/api/comfyui/view/";

export const GeneratedImageAttachmentSchema = z.object({
  kind: z.literal("generated_image"),
  url: z.string().startsWith(COMFYUI_VIEW_PREFIX),
});

export const WebSourceAttachmentSchema = z.object({
  kind: z.literal("web_source"),
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
});

export const MessageAttachmentSchema = z.discriminatedUnion("kind", [
  ImageAttachmentSchema,
  WorkspaceFileAttachmentSchema,
  GeneratedImageAttachmentSchema,
  WebSourceAttachmentSchema,
]);

export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
export type WorkspaceFileAttachment = z.infer<
  typeof WorkspaceFileAttachmentSchema
>;
export type GeneratedImageAttachment = z.infer<
  typeof GeneratedImageAttachmentSchema
>;
export type WebSourceAttachment = z.infer<typeof WebSourceAttachmentSchema>;
/** Output a tool attaches to the assistant reply, independent of the reply text. */
export type ToolOutputAttachment =
  | GeneratedImageAttachment
  | WebSourceAttachment;

export function imageUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}
