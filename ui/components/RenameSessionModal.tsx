import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function RenameSessionModal({
  initialTitle,
  placeholder,
  onSave,
  onClose,
}: {
  initialTitle: string;
  placeholder?: string;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Modal
      title="Rename"
      eyebrow="Chat"
      ariaLabelledBy="rename-session-title"
      onClose={onClose}
      maxWidthClass="max-w-[400px]"
      surfaceClassName="max-h-none grid-rows-1"
      initialFocusRef={inputRef}
    >
      <form
        className="flex flex-col gap-2 px-[18px] pb-[18px] pt-0"
        onSubmit={(e) => {
          e.preventDefault();
          const title = value.trim();
          if (title === initialTitle) onClose();
          else onSave(title);
        }}
      >
        <label
          className="text-[0.8125rem] font-medium text-muted-foreground"
          htmlFor="rename-session-input"
        >
          Display name
        </label>
        <input
          id="rename-session-input"
          ref={inputRef}
          className="w-full rounded-lg border border-border-subtle bg-background px-3 py-2.5 text-[0.9375rem] text-foreground outline-none focus:border-accent focus:shadow-[0_0_0_1px_var(--color-accent-ring)]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <p className="m-0 text-[0.75rem] leading-[1.45] text-muted-foreground">
          Leave empty to use the first message as the title.
        </p>
        <div className="mt-[14px] flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
