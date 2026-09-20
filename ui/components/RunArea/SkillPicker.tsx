import { BookOpen } from "lucide-react";
import type { SkillData } from "../../persist/skills";
import { cx } from "../../styles";

export interface SkillPickerProps {
  skills: readonly SkillData[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onSelectSkill: (skill: SkillData) => void;
}

export function SkillPicker({
  skills,
  selectedIndex,
  onSelectIndex,
  onSelectSkill,
}: SkillPickerProps) {
  if (skills.length === 0) return null;

  return (
    <div
      id="skill-picker"
      className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
      aria-label="Available skills"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <BookOpen size={13} />
        Skills
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {skills.map((skill, index) => (
          <button
            key={skill.id}
            type="button"
            aria-current={index === selectedIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onSelectIndex(index)}
            onClick={() => onSelectSkill(skill)}
            className={cx(
              "flex w-full min-w-0 items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              index === selectedIndex
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="shrink-0 font-mono text-[0.8125rem] font-medium text-foreground">
              ${skill.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.75rem] leading-[1.45]">
              {skill.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
