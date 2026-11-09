import type { ServiceImpl } from "@connectrpc/connect";
import { detectImageMimeType, safeFilename } from "../attachments/images";
import {
  createImageAttachment,
  deleteAttachment,
  getAttachment,
} from "../db/index";
import type { AttachmentService } from "../gen/euler/v1/attachments_pb";
import { OperationError } from "../observability/errors";
import { ownedSession, ownerOf } from "./context";

const notFound = () =>
  new OperationError("NOT_FOUND", { message: "Attachment not found" });

export const attachmentService: ServiceImpl<typeof AttachmentService> = {
  createAttachment(request, context) {
    const session = ownedSession(context, request.sessionId.trim());
    const mimeType = detectImageMimeType(request.data);
    if (!mimeType || mimeType !== request.mimeType)
      throw new OperationError("UNSUPPORTED_MEDIA_TYPE", {
        message: "Unsupported image type",
      });
    const attachment = createImageAttachment({
      ownerUuid: session.owner_uuid,
      sessionId: session.id,
      name: safeFilename(request.filename),
      mimeType,
      data: request.data,
    });
    return {
      attachment: {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      },
    };
  },
  getAttachmentData(request, context) {
    const attachment = getAttachment(ownerOf(context), request.id);
    if (!attachment) throw notFound();
    return { mimeType: attachment.mimeType, data: attachment.data };
  },
  deleteAttachment(request, context) {
    if (!deleteAttachment(ownerOf(context), request.id)) throw notFound();
    return {};
  },
};
