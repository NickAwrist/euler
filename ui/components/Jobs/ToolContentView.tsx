import type { ToolContent } from "../../../src/gen/euler/v1/common_pb";

/** Renders the shared content contract. No tool names or tool-specific fields. */
export function ToolContentView({ content }: { content: ToolContent }) {
  return (
    <div className="space-y-2">
      {content.blocks.map(({ kind: block }, index) => (
        <div key={`${block.case}:${index}`}>
          {block.case !== "fields" && block.value?.label && (
            <p className="mb-1 text-xs text-muted-foreground">
              {block.value.label}
            </p>
          )}
          {block.case === "text" && (
            <p className="whitespace-pre-wrap break-words text-sm">
              {block.value.text}
            </p>
          )}
          {block.case === "code" && (
            <pre
              className="max-h-[35vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border-subtle bg-muted/30 p-3 text-xs"
              data-language={block.value.language}
            >
              {block.value.text}
            </pre>
          )}
          {block.case === "fields" && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border border-border-subtle p-3 text-xs">
              {block.value.fields.map((field, fieldIndex) => (
                <div key={`${field.label}:${fieldIndex}`} className="contents">
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
