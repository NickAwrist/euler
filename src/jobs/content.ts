import type { ToolContent, ToolContentUpdate } from "../schemas/toolContent";
const MAX_BYTES = 65536;
const contentBytes = (content: ToolContent) =>
  Buffer.byteLength(JSON.stringify(content));
function tail(text: string, bytes: number) {
  let result = Buffer.from(text).subarray(-Math.max(0, bytes)).toString();
  if (bytes <= 0) return "";
  while (Buffer.byteLength(result) > bytes) result = result.slice(1);
  return result;
}
/** Bound tool-owned content without assuming stream names or a particular tool. */
export function updateContent(
  current: ToolContent | null,
  update: ToolContentUpdate,
) {
  const sources =
    update.mode === "replace"
      ? [update.content]
      : [current ?? { blocks: [] }, update.content];
  const content: ToolContent = { blocks: [] };
  for (const source of structuredClone(sources))
    for (const block of source.blocks) {
      const previous = content.blocks.at(-1);
      if (
        block.kind === "code" &&
        previous?.kind === "code" &&
        block.label === previous.label &&
        block.language === previous.language
      )
        previous.text += block.text;
      else content.blocks.push(block);
    }
  let truncated = false;
  while (content.blocks.length > 32 || contentBytes(content) > MAX_BYTES) {
    truncated = true;
    if (content.blocks.length > 1) {
      content.blocks.shift();
      continue;
    }
    const block = content.blocks[0]!;
    if (block.kind === "fields" && block.fields.length > 1) {
      block.fields.shift();
      continue;
    }
    if (block.kind === "code" || block.kind === "text") {
      const text = block.text;
      block.text = "";
      block.text = tail(text, MAX_BYTES - contentBytes(content));
    } else if (block.kind === "fields") {
      const field = block.fields[0]!;
      const value = field.value;
      field.value = "";
      field.value = tail(value, MAX_BYTES - contentBytes(content));
    }
    // JSON escaping can grow a retained string beyond its raw byte length.
    if (contentBytes(content) > MAX_BYTES) {
      if (block.kind === "code" || block.kind === "text")
        block.text = block.text.slice(Math.ceil(block.text.length / 2));
      else if (block.kind === "fields")
        block.fields[0]!.value = block.fields[0]!.value.slice(
          Math.ceil(block.fields[0]!.value.length / 2),
        );
    }
  }
  return { content, truncated };
}
