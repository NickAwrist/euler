import { useRef, useState } from "react";
import type { SkillWriteBody } from "../../persist/skills";
import { cx, textareaClass } from "../../styles";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { parseSkillMarkdown } from "./skillsPageUtils";

export function ImportSkillModal({
  onImport,
  onClose,
}: {
  onImport: (skill: SkillWriteBody) => void;
  onClose: () => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Modal
      title="Import SKILL.md"
      eyebrow="Skills"
      onClose={onClose}
      maxWidthClass="max-w-[640px]"
      surfaceClassName="max-h-none grid-rows-1"
      initialFocusRef={textareaRef}
    >
      <form
        className="flex flex-col gap-2 px-[18px] pb-[18px] pt-0"
        onSubmit={(event) => {
          event.preventDefault();
          onImport(parseSkillMarkdown(markdown));
        }}
      >
        <textarea
          ref={textareaRef}
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          aria-label="SKILL.md contents"
          placeholder={
            "---\nname: release-notes\ndescription: Draft release notes from merged changes.\n---\n\n# Workflow\n..."
          }
          rows={14}
          spellCheck={false}
          className={cx(textareaClass, "font-mono text-[0.8125rem]")}
          style={{ resize: "vertical" }}
        />
        <p className="m-0 text-[0.75rem] leading-[1.45] text-muted-foreground">
          Reads name, description, user-invocable, and disable-model-invocation
          from the frontmatter. Review the skill before saving.
        </p>
        <div className="mt-[14px] flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!markdown.trim()}>
            Import
          </Button>
        </div>
      </form>
    </Modal>
  );
}
