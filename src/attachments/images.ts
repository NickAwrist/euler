import { basename } from "node:path";
import { ImageMimeType } from "./types";

/** A display name from an uploaded file's name, without paths or control characters. */
export function safeFilename(value: string): string {
  const clean = Array.from(basename(value))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 255);
  return clean || "image";
}

/** The image type the bytes start with, or null when they are not a supported image. */
export function detectImageMimeType(data: Uint8Array): ImageMimeType | null {
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
