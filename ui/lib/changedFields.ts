/** Only send edits made in this view, preserving changes from other devices. */
export function changedFields<T extends object>(
  current: T,
  saved: T,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(current) as Array<keyof T>) {
    if (!Object.is(current[key], saved[key])) patch[key] = current[key];
  }
  return patch;
}
