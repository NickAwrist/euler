import { useSyncExternalStore } from "react";

const query = "(max-width: 900px)";
const getSnapshot = () => window.matchMedia(query).matches;
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
