type SortableModel = {
  favorite?: boolean;
  created?: number;
  name: string;
};

/** Favorites first, then newest additions; unknown dates sort last. */
export function compareModels(a: SortableModel, b: SortableModel): number {
  return (
    Number(b.favorite ?? false) - Number(a.favorite ?? false) ||
    (b.created ?? 0) - (a.created ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/** Publisher settings put enabled models ahead of disabled models. */
export function comparePublisherModels(
  a: SortableModel & { enabled: boolean },
  b: SortableModel & { enabled: boolean },
): number {
  return (
    Number(b.favorite ?? false) - Number(a.favorite ?? false) ||
    Number(b.enabled) - Number(a.enabled) ||
    compareModels(a, b)
  );
}
