import { RotateCcw } from "lucide-react";
import { useRef } from "react";
import { PROMPT_PLACEHOLDER_LIST } from "../../../src/prompts/render";
import { DEFAULT_SYSTEM_PROMPT } from "../../../src/prompts/systemPrompt";
import { cx, textareaClass } from "../../styles";
import { Button } from "../Button";
import { hintClass, labelClass } from "./constants";

function insertAtCaret(
  textarea: HTMLTextAreaElement | null,
  current: string,
  token: string,
): { next: string; caret: number } {
  const fallback = `${current}${current.length && !current.endsWith("\n") ? "\n\n" : ""}${token}`;
  if (!textarea) {
    return { next: fallback, caret: fallback.length };
  }
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const next = `${before}${token}${after}`;
  return { next, caret: before.length + token.length };
}

type Props = {
  /** Custom template, or `null` to follow the default prompt. */
  value: string | null;
  onChange: (value: string | null) => void;
};

export function SystemPromptField({ value, onChange }: Props) {
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const prompt = value ?? DEFAULT_SYSTEM_PROMPT;
  const update = (next: string) =>
    onChange(next === DEFAULT_SYSTEM_PROMPT ? null : next);

  const insertPlaceholder = (token: string) => {
    const { next, caret } = insertAtCaret(promptRef.current, prompt, token);
    update(next);
    queueMicrotask(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="systemPrompt" className={labelClass}>
          System Prompt
        </label>
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          Reset to default
        </Button>
      </div>
      <textarea
        id="systemPrompt"
        ref={promptRef}
        value={prompt}
        onChange={(e) => update(e.target.value)}
        rows={12}
        className={cx(textareaClass, "font-mono text-[0.8125rem]")}
        style={{ resize: "vertical" }}
      />
      <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-muted/15 px-3 py-2">
        <span className="text-[0.7rem] font-medium text-muted-foreground">
          Placeholders (click to insert)
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_PLACEHOLDER_LIST.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.description}
              onClick={() => insertPlaceholder(p.token)}
              className="rounded-md border border-border-subtle bg-background px-2 py-0.5 font-mono text-[0.7rem] text-foreground transition-colors hover:border-border hover:bg-accent-soft-strong"
            >
              {p.token}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 text-[0.68rem] leading-snug text-muted-foreground">
          {PROMPT_PLACEHOLDER_LIST.map((p) => (
            <span key={p.key}>
              <code className="font-mono text-[0.7rem] text-foreground/80">
                {p.token}
              </code>{" "}
              - {p.description}
            </span>
          ))}
        </div>
      </div>
      <p className={hintClass}>
        Instructions for the agent and its subagents. An empty prompt uses the
        default.
      </p>
    </div>
  );
}
