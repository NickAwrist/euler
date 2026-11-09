import type { MessageAttachment } from "../../src/gen/euler/v1/attachments_pb";

type Kind = MessageAttachment["kind"];
type Case = NonNullable<Kind["case"]>;
type Value<K extends Case> = Extract<Kind, { case: K }>["value"];

/** The attachments of one kind, unwrapped from the oneof. */
export function attachmentsOfKind<K extends Case>(
  attachments: readonly { kind: Kind }[] | undefined,
  kind: K,
): Value<K>[] {
  const values: Value<K>[] = [];
  for (const { kind: attachment } of attachments ?? [])
    if (attachment.case === kind) values.push(attachment.value as Value<K>);
  return values;
}
