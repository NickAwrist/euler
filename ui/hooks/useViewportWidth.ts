import { useSyncExternalStore } from "react";

const getSnapshot = () => window.innerWidth;
function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
