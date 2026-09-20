import type { SessionSummary } from "../../types";

export type SidebarProps = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onNewEphemeralSession: () => void;
  onRenameSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  isLoading: boolean;
  onCustomization: () => void;
  onSettings: () => void;
};
