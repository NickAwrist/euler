import { useCallback, useEffect, useState } from "react";

export interface UseListNavigationOptions<T> {
  items: readonly T[];
  onSelect: (item: T) => void;
  onDismiss?: () => void;
  resetKey?: unknown;
}

export function useListNavigation<T>({
  items,
  onSelect,
  onDismiss,
  resetKey,
}: UseListNavigationOptions<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [resetKey]);

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, selectedIndex]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (items.length === 0) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (current) => (current - 1 + items.length) % items.length,
        );
        return true;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const item = items[selectedIndex];
        if (item !== undefined) {
          onSelect(item);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss?.();
        return true;
      }
      return false;
    },
    [items, onSelect, onDismiss, selectedIndex],
  );

  return {
    selectedIndex,
    setSelectedIndex,
    onKeyDown,
  };
}
