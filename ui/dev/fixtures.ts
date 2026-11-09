import { type MessageInitShape, create } from "@bufbuild/protobuf";
import {
  type MessageAttachment,
  MessageAttachmentSchema,
  type WorkspaceFileAttachment_WorkspaceKind,
} from "../../src/gen/euler/v1/attachments_pb";
import {
  type Message,
  MessageSchema,
  Message_Role,
} from "../../src/gen/euler/v1/sessions_pb";
import { type Step, StepSchema } from "../../src/gen/euler/v1/steps_pb";

// Builders for the generated messages dev pages show.

const ROLES = {
  user: Message_Role.USER,
  assistant: Message_Role.ASSISTANT,
  event: Message_Role.EVENT,
} as const;

export function fixtureMessage(
  role: keyof typeof ROLES,
  content: string,
  fields: Pick<
    MessageInitShape<typeof MessageSchema>,
    "steps" | "attachments" | "versions"
  > = {},
): Message {
  return create(MessageSchema, { ...fields, role: ROLES[role], content });
}

export const fixtureStep = (
  fields: MessageInitShape<typeof StepSchema>,
): Step => create(StepSchema, fields);

export const generatedImage = (url: string): MessageAttachment =>
  create(MessageAttachmentSchema, {
    kind: { case: "generatedImage", value: { url } },
  });

export const webSource = (title: string, url: string): MessageAttachment =>
  create(MessageAttachmentSchema, {
    kind: { case: "webSource", value: { title, url } },
  });

export const workspaceFile = (file: {
  id: string;
  name: string;
  size: number;
  path: string;
  sessionId: string;
  workspaceKind: WorkspaceFileAttachment_WorkspaceKind;
}): MessageAttachment =>
  create(MessageAttachmentSchema, {
    kind: { case: "file", value: { ...file, size: BigInt(file.size) } },
  });
