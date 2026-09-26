import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import type { SessionSummary } from "../types";

type UseAppKeybindsOptions = {
  blockShortcuts: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  switchToSession: (id: string) => void | Promise<void>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  goToHome: () => void | Promise<void>;
  headerRunBusy: boolean;
};

function suppress(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

export function useAppKeybinds(opts: UseAppKeybindsOptions) {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current;
      if (o.blockShortcuts) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.repeat) return;

      const k = e.key.toLowerCase();

      // Ctrl+] next session, Ctrl+[ prev session
      if (k === "]" || k === "[") {
        if (o.sessions.length === 0) return;
        suppress(e);

        if (o.activeSessionId == null) {
          o.switchToSession(
            k === "["
              ? o.sessions[o.sessions.length - 1]!.id
              : o.sessions[0]!.id,
          );
          return;
        }

        const idx = o.sessions.findIndex((s) => s.id === o.activeSessionId);
        if (idx === -1) {
          o.switchToSession(o.sessions[0]!.id);
          return;
        }

        const delta = k === "[" ? -1 : 1;
        let next = idx + delta;
        if (next < 0) next = o.sessions.length - 1;
        if (next >= o.sessions.length) next = 0;
        o.switchToSession(o.sessions[next]!.id);
        return;
      }

      if (k === "b") {
        suppress(e);
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        if (mobile) o.setSidebarOpen((prev) => !prev);
        else o.setSidebarCollapsed((prev) => !prev);
        return;
      }

      // Ctrl+E new chat
      if (k === "e" && !e.shiftKey) {
        suppress(e);
        o.goToHome();
        return;
      }

      if (k === "m" && !e.shiftKey) {
        if (o.headerRunBusy || !o.activeSessionId) return;
        suppress(e);
        queueMicrotask(() => {
          const el = document.getElementById("run-model");
          if (!(el instanceof HTMLButtonElement) || el.disabled) return;
          el.focus();
          el.click();
        });
        return;
      }

      if (k === "h" && e.shiftKey) {
        suppress(e);
        o.goToHome();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
