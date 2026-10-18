import type { InputCapability } from "../../src/models/modelCapabilities";
import type { ModelReasoning } from "../../src/models/openRouterModels";

export type { ModelReasoning };

/** Normalized entry from GET /api/models. */
export interface ModelOption {
  id: string;
  name: string;
  provider: "ollama" | "openrouter" | "chatgpt";
  lab: string;
  route?: string;
  publisherId?: string;
  favorite?: boolean;
  isNew?: boolean;
  created?: number;
  supportsTools?: boolean;
  contextLength?: number | null;
  promptPricePerMillion?: number | null;
  completionPricePerMillion?: number | null;
  availability?: "available" | "unavailable" | "unverified";
  configured?: boolean;
  size?: number;
  modified_at?: string;
  digest?: string;
  inputCapabilities: InputCapability[];
  reasoning?: ModelReasoning | null;
}
