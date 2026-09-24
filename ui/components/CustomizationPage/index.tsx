import { BackToChatButton } from "../BackToChatButton";
import { SkillsPanel } from "./SkillsPanel";

export function CustomizationPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-3">
        <BackToChatButton onClick={onBack} />
        <div className="h-4 w-px bg-border-subtle" />
        <h1 className="text-[0.9375rem] font-semibold text-foreground">
          Customization
        </h1>
      </header>

      <SkillsPanel />
    </div>
  );
}
