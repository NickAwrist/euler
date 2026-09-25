import type { SettingsTab } from "../types";

export const NAVIGATION_EVENT = "euler:navigate";
export type NavigationGuard = (path: string) => Promise<boolean>;
let guard: NavigationGuard | null = null;
let index = 0;
let listening = false;
let pending = false;
let restore: (() => void) | null = null;
let approvedIndex: number | null = null;
let currentPath = "";

function settingsTab(path: string): SettingsTab {
  const tab = path.split("/")[2];
  return tab === "ollama" ||
    tab === "openrouter" ||
    tab === "image-generation" ||
    tab === "web-search"
    ? tab
    : "general";
}

type AppRoute =
  | { view: "run"; sessionId: string | null }
  | { view: "settings"; tab: SettingsTab }
  | { view: "customization" | "usage" };

export function parseRoute(path = window.location.pathname): AppRoute {
  if (path === "/settings" || path.startsWith("/settings/")) {
    return { view: "settings", tab: settingsTab(path) };
  }
  if (path === "/customization" || path === "/usage") {
    return { view: path === "/usage" ? "usage" : "customization" };
  }
  let sessionId: string | null = null;
  if (path.startsWith("/run/")) {
    try {
      sessionId = decodeURIComponent(path.slice("/run/".length)) || null;
    } catch {
      // A malformed link should still allow returning to Home.
    }
  }
  return { view: "run", sessionId };
}

export function isChatPath(path = window.location.pathname) {
  return parseRoute(path).view === "run";
}

export function sessionIdFromUrl() {
  const route = parseRoute();
  return route.view === "run" ? route.sessionId : null;
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
    let nextIndex = window.history.state?.navigationIndex;
    if (typeof nextIndex !== "number") {
      // Native fragment links create same-document entries without our state.
      // Count and stamp them when created so later Back/Forward deltas stay valid.
      nextIndex = index + 1;
      window.history.replaceState(
        { ...window.history.state, navigationIndex: nextIndex },
        "",
      );
    }
    if (window.location.pathname === currentPath) {
      index = nextIndex;
      return;
    }
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
