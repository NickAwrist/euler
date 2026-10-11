import { useRef, useState } from "react";
import { cx, textareaClass } from "../../styles";
import { Button } from "../Button";
import { Modal } from "../Modal";

const PLACEHOLDER = `{
  "mcpServers": {
    "example": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}`;

export function AddMcpServersModal({
  onAdd,
  onClose,
}: {
  onAdd: (config: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      setError("Config is not valid JSON");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd(config);
      onClose();
    } catch (addError: unknown) {
      setError(
        addError instanceof Error ? addError.message : "Failed to add servers",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add MCP servers"
      eyebrow="MCP"
      onClose={onClose}
      busy={saving}
      maxWidthClass="max-w-[640px]"
      surfaceClassName="max-h-none grid-rows-1"
      initialFocusRef={textareaRef}
    >
      <form
        className="flex flex-col gap-2 px-[18px] pb-[18px] pt-0"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="MCP server config"
          aria-invalid={error !== null}
          aria-describedby="mcp-config-hint"
          placeholder={PLACEHOLDER}
          rows={12}
          spellCheck={false}
          className={cx(textareaClass, "font-mono text-[0.8125rem]")}
          style={{ resize: "vertical" }}
        />
        <p
          id="mcp-config-hint"
          className={cx(
            "m-0 text-[0.75rem] leading-[1.45]",
            error
              ? "text-red-400 first-letter:uppercase"
              : "text-muted-foreground",
          )}
        >
          {error ??
            "Paste an mcpServers config for remote servers. Header values are stored but never shown again."}
        </p>
        <div className="mt-[14px] flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={saving}
            disabled={!text.trim() || saving}
          >
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
