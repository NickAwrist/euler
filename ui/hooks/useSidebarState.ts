import { useEffect, useState } from "react";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../persist/userPreferences";

export function useSidebarState() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return getUserPreferences().layout.sidebarCollapsed;
  });

  useEffect(() => {
    if (sidebarCollapsed === getUserPreferences().layout.sidebarCollapsed)
      return;
    void updateUserPreferences({ layout: { sidebarCollapsed } }).catch(
      console.error,
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
  };
}
