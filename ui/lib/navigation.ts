import type { SettingsTab } from "../components/SettingsPage/types";

export const NAVIGATION_EVENT = "euler:navigate";
export type NavigationGuard = (path: string) => Promise<boolean>;
let guard: NavigationGuard | null = null;
let index = 0;
let listening = false;
let pending = false;
let restore: (() => void) | null = null;
let approvedIndex: number | null = null;
let currentPath = "";

export function settingsTab(path = window.location.pathname): SettingsTab {
  const tab = path.split("/")[2];
  return tab === "ollama" ||
    tab === "openrouter" ||
    tab === "image-generation" ||
    tab === "web-search"
    ? tab
    : "general";
}

export function isChatPath(path = window.location.pathname) {
  return path === "/" || path.startsWith("/run/");
}

export function sessionPath(id: string | null) {
  return id ? `/run/${encodeURIComponent(id)}` : "/";
}

function notify(historyTraversal = false) {
  const previousPath = currentPath;
  currentPath = window.location.pathname;
  window.dispatchEvent(
    new CustomEvent(NAVIGATION_EVENT, {
      detail: { historyTraversal, previousPath },
    }),
  );
}

export function initializeNavigation() {
  if (listening) return;
  listening = true;
  currentPath = window.location.pathname;
  index =
    typeof window.history.state?.navigationIndex === "number"
      ? window.history.state.navigationIndex
      : 0;
  window.history.replaceState(
    { ...window.history.state, navigationIndex: index },
    "",
  );
  window.addEventListener("popstate", async () => {
    if (restore) {
      const done = restore;
      restore = null;
      done();
      return;
    }
    const nextIndex = window.history.state?.navigationIndex ?? 0;
    if (approvedIndex === nextIndex) {
      approvedIndex = null;
      index = nextIndex;
      notify(true);
      return;
    }
    const path = window.location.pathname;
    if (guard && nextIndex !== index) {
      const delta = nextIndex - index;
      const alreadyPending = pending;
      pending = true;
      await new Promise<void>((resolve) => {
        restore = resolve;
        window.history.go(-delta);
      });
      if (alreadyPending) return;
      const approved = await guard(path);
      pending = false;
      if (approved) {
        approvedIndex = nextIndex;
        window.history.go(delta);
      }
      return;
    }
    index = nextIndex;
    notify(true);
  });
}

export function setNavigationGuard(next: NavigationGuard) {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

export async function navigate(path: string) {
  initializeNavigation();
  if (pending || window.location.pathname === path) return;
  if (guard) {
    pending = true;
    const approved = await guard(path);
    pending = false;
    if (!approved) return;
  }
  window.history.pushState({ navigationIndex: ++index }, "", path);
  notify();
}

export function replaceNavigation(path: string) {
  initializeNavigation();
  window.history.replaceState(
    { ...window.history.state, navigationIndex: index },
    "",
    path,
  );
}
