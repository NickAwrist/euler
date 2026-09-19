import { basename } from "node:path";
import express, { Router } from "express";
import {
  IMAGE_MIME_TYPES,
  ImageMimeType,
  MAX_IMAGE_BYTES,
  type MessageAttachment,
} from "../attachments/types";
import {
  createImageAttachment,
  deleteAttachment,
  getAttachment,
  getSessionById,
} from "../db/index";
import { sendApiError } from "../http/errors";
import { requireUserId } from "../userIdentity";

const router = Router();

function safeFilename(value: unknown): string {
  const decoded =
    typeof value === "string"
      ? (() => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        })()
      : "image";
  const clean = Array.from(basename(decoded))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 255);
  return clean || "image";
}

function detectImageMimeType(data: Uint8Array): ImageMimeType | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return ImageMimeType.Png;
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return ImageMimeType.Jpeg;
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) {
    return ImageMimeType.Webp;
  }
  if (data.length >= 6) {
    const signature = String.fromCharCode(...data.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return ImageMimeType.Gif;
    }
  }
  return null;
}

router.post(
  "/",
  express.raw({ type: [...IMAGE_MIME_TYPES], limit: MAX_IMAGE_BYTES }),
  (req, res) => {
    const ownerUuid = requireUserId(req, res);
    if (!ownerUuid) return;
    const sessionId = req.header("X-Euler-Session-ID")?.trim() ?? "";
    if (!sessionId || !getSessionById(ownerUuid, sessionId)) {
      sendApiError(res, 404, "NOT_FOUND", "Session not found");
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      sendApiError(res, 400, "BAD_REQUEST", "Image data is required");
      return;
    }
    const mimeType = detectImageMimeType(req.body);
    if (!mimeType || mimeType !== req.header("Content-Type")) {
      sendApiError(res, 415, "BAD_REQUEST", "Unsupported image type");
      return;
    }
    const attachment: MessageAttachment = createImageAttachment({
      ownerUuid,
      sessionId,
      name: safeFilename(req.header("X-Attachment-Filename")),
      mimeType,
      data: req.body,
    });
    res.status(201).json({ attachment });
  },
);

router.get("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const attachment = getAttachment(ownerUuid, req.params.id);
  if (!attachment) {
    sendApiError(res, 404, "NOT_FOUND", "Attachment not found");
    return;
  }
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Length", String(attachment.size));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(attachment.data));
});

router.delete("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (!deleteAttachment(ownerUuid, req.params.id)) {
    sendApiError(res, 404, "NOT_FOUND", "Attachment not found");
    return;
  }
  res.json({ ok: true });
});

export default router;
