import { cx } from "../styles";

export function PageTabRail<T extends string>({
  label,
  tabs,
  activeTab,
  onTabChange,
  dirtyTabs = [],
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  dirtyTabs?: readonly T[];
}) {
  return (
    <nav
      aria-label={label}
      className="flex shrink-0 flex-wrap gap-x-1 border-b border-border-subtle px-3 sm:flex-nowrap sm:px-5"
    >
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-current={activeTab === id ? "page" : undefined}
          className={cx(
            "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors sm:px-4",
            activeTab === id
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onTabChange(id)}
        >
          {label}
          {dirtyTabs.includes(id) && (
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </nav>
  );
}
