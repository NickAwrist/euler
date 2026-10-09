/**
 * Runs `task` with `setRunning(true)` until it settles. React Compiler cannot
 * compile try/finally inside components and hooks, so the pattern lives here.
 */
export async function whileRunning<T>(
  setRunning: (running: boolean) => void,
  task: () => Promise<T>,
): Promise<T> {
  setRunning(true);
  try {
    return await task();
  } finally {
    setRunning(false);
  }
}

/** A `setRunning` for `whileRunning` that tracks `key` in a set of pending keys. */
export function setKeyPending(
  setPending: (update: (current: Set<string>) => Set<string>) => void,
  key: string,
) {
  return (running: boolean) =>
    setPending((current) => {
      const next = new Set(current);
      if (running) next.add(key);
      else next.delete(key);
      return next;
    });
}
