import { ArrowLeft } from "lucide-react";
export function BackToChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft size={15} />
      Back to chat
    </button>
  );
}
