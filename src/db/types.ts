import type { MessageAttachment } from "../attachments/types";
import type { MessageVersion } from "../schemas/run";

export type WireMessage = {
  role: string;
  content: string;
  steps?: unknown;
  attachments?: MessageAttachment[];
  versions?: MessageVersion[];
};

export type SessionRow = {
  id: string;
  owner_uuid: string;
  created_at: number;
  updated_at: number;
  title: string | null;
  model: string | null;
  model_messages: string | null;
  session_directory: string | null;
  workspace_kind: "sandbox" | "local";
};

export type SessionSummaryRow = {
  id: string;
  created_at: number;
  updated_at: number;
  title: string | null;
  preview: string;
};

export type OpenRouterModel = {
  route: string;
  publisher_id: string;
  name: string;
  enabled: number;
  catalog_created_at: number;
};
