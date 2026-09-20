import { Command } from "lucide-react";
import { cx } from "../../styles";
import type { RunCommand, RunCommandName } from "../runCommands";

export interface CommandPickerProps {
  commands: readonly RunCommand[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onSelectCommand: (command: RunCommandName) => void;
}

export function CommandPicker({
  commands,
  selectedIndex,
  onSelectIndex,
  onSelectCommand,
}: CommandPickerProps) {
  if (commands.length === 0) return null;

  return (
    <div
      id="command-picker"
      className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-40 overflow-hidden rounded-xl border border-border-subtle bg-surface p-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
      aria-label="Chat commands"
    >
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          aria-current={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onSelectIndex(index)}
          onClick={() => onSelectCommand(command.name)}
          className={cx(
            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left",
            index === selectedIndex
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <Command size={14} className="shrink-0" />
          <span className="font-mono text-[0.8125rem] text-foreground">
            /{command.name}
          </span>
          <span className="truncate text-xs">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
