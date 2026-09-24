import { BookOpen, Plus } from "lucide-react";
import type { SkillData } from "../../persist/skills";
import { cx, eyebrowText } from "../../styles";

type Props = {
  skills: SkillData[];
  selectedId: string | null;
  isNew: boolean;
  onSelectSkill: (skill: SkillData) => void;
  onStartNew: () => void;
};

export function SkillList({
  skills,
  selectedId,
  isNew,
  onSelectSkill,
  onStartNew,
}: Props) {
  return (
    <div className="flex min-h-0 flex-col border-r border-border-subtle max-[700px]:border-b max-[700px]:border-r-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className={eyebrowText}>Skills</span>
        <button
          type="button"
          onClick={onStartNew}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-accent transition-colors hover:bg-muted"
        >
          <Plus size={14} />
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {skills.map((skill) => {
          const active = selectedId === skill.id && !isNew;
          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => onSelectSkill(skill)}
              className={cx(
                "mb-0.5 flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                active
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              )}
            >
              <BookOpen size={15} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.8125rem] font-medium">
                  ${skill.name}
                </div>
                <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                  {skill.description}
                </div>
              </div>
            </button>
          );
        })}
        {skills.length === 0 && !isNew && (
          <p className="px-3 py-3 text-[0.75rem] leading-[1.5] text-muted-foreground">
            No skills yet. Create one to teach agents a reusable workflow.
          </p>
        )}
      </div>
    </div>
  );
}
