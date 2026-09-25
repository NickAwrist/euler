import type { Message } from "../types";

const SEP = "\n\n";

const ROLE_LABELS = {
  user: "USER",
  assistant: "MODEL",
  event: "EVENT",
} as const satisfies Record<Message["role"], string>;

function block(
  roleLabel: (typeof ROLE_LABELS)[Message["role"]],
  content: string,
): string {
  return `${roleLabel}\n===\n${content}`;
}

/**
 * Full run export: a title heading with export metadata, then USER / MODEL / EVENT
 * blocks with `===` under each label.
 * Optionally appends the in-flight assistant reply when `streamingAssistant` is non-empty.
 */
export function formatRunTranscript(
  messages: Message[],
  options: {
    title: string;
    exportedAt: Date;
    model?: string | null;
    streamingAssistant?: string;
  },
): string {
  const meta = [`- Exported: ${options.exportedAt.toISOString()}`];
  if (options.model) meta.push(`- Model: ${options.model}`);
  const parts = [`# ${options.title}`, meta.join("\n")];
  for (const m of messages) parts.push(block(ROLE_LABELS[m.role], m.content));
  const stream = options.streamingAssistant;
  if (stream?.trim()) parts.push(block(ROLE_LABELS.assistant, stream));
  return parts.join(SEP);
}

/** Markdown file name derived from the chat title, e.g. `planning-a-trip.md`. */
export function transcriptFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${slug || "chat"}.md`;
}
