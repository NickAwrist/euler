import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type ImageAttachment,
  ImageMimeTypeSchema,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
} from "../../../src/attachments/types";
import { whileRunning } from "../../lib/whileRunning";
import { uploadImageAttachment } from "../../persist/attachments";
import { createBrowserUuid } from "../../persist/userIdentity";

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type Args = {
  activeSessionId: string | null;
  supportsImageInput: boolean;
};

export function usePendingImages({
  activeSessionId,
  supportsImageInput,
}: Args) {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  useLayoutEffect(() => {
    pendingImagesRef.current = pendingImages;
  });

  const clearPendingImages = useCallback(() => {
    for (const image of pendingImagesRef.current) {
      URL.revokeObjectURL(image.previewUrl);
    }
    pendingImagesRef.current = [];
    setPendingImages([]);
    setImageError(null);
  }, []);

  useEffect(() => clearPendingImages, [clearPendingImages]);

  useEffect(() => {
    clearPendingImages();
  }, [activeSessionId, clearPendingImages]);

  useEffect(() => {
    if (pendingImages.length === 0) return;
    if (!supportsImageInput)
      setImageError("The selected model does not accept images.");
  }, [supportsImageInput, pendingImages.length]);

  const addPendingImages = useCallback(
    (files: File[]) => {
      if (!supportsImageInput) {
        setImageError("The selected model does not accept images.");
        return;
      }

      const accepted: PendingImage[] = [];
      for (const file of files) {
        if (!ImageMimeTypeSchema.safeParse(file.type).success) {
          setImageError("Use a PNG, JPEG, WebP, or GIF image.");
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setImageError("Each image must be 8 MB or smaller.");
          continue;
        }
        if (
          pendingImagesRef.current.length + accepted.length >=
          MAX_IMAGES_PER_MESSAGE
        ) {
          setImageError(
            `You can attach up to ${MAX_IMAGES_PER_MESSAGE} images.`,
          );
          break;
        }
        accepted.push({
          id: createBrowserUuid(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (accepted.length > 0) {
        setPendingImages((current) => [...current, ...accepted]);
        if (accepted.length === files.length) setImageError(null);
      }
    },
    [supportsImageInput],
  );

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.id !== id);
    });
    setImageError(null);
  }, []);

  const uploadPendingImages = useCallback(
    (sessionId: string): Promise<ImageAttachment[] | null> =>
      whileRunning(setUploadPending, async () => {
        try {
          return await Promise.all(
            pendingImages.map((image) =>
              uploadImageAttachment(sessionId, image.file),
            ),
          );
        } catch (error) {
          setImageError(
            error instanceof Error ? error.message : "Could not upload image.",
          );
          return null;
        }
      }),
    [pendingImages],
  );

  const canAttachImages = supportsImageInput;

  return {
    pendingImages,
    imageError,
    setImageError,
    uploadPending,
    addPendingImages,
    removePendingImage,
    clearPendingImages,
    uploadPendingImages,
    canAttachImages,
    attachmentsSendReady: pendingImages.length === 0 || canAttachImages,
    attachImageDisabledReason: !supportsImageInput
      ? "The selected model does not accept images"
      : undefined,
  };
}
