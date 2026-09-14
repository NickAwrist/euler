import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const DB_PATH =
  process.env.AGENTS_DB_PATH ||
  (process.env.DEPLOYCTL_DATA_DIR
    ? join(process.env.DEPLOYCTL_DATA_DIR, "agents.db")
    : join(process.cwd(), "data", "agents.db"));

export const DATA_ROOT =
  process.env.ORBIS_DATA_ROOT ||
  (process.env.DEPLOYCTL_DATA_DIR
    ? process.env.DEPLOYCTL_DATA_DIR
    : DB_PATH === ":memory:"
      ? join(tmpdir(), `orbis-test-${process.pid}`)
      : dirname(DB_PATH));

export const DEFAULT_RUN_AGENT_KEY = "default_run_agent";
export const LEGACY_USER_DATA_CLAIMED_BY_KEY = "legacy_user_data_claimed_by";
export const OLLAMA_HOST_KEY = "ollama_host";
export const COMFYUI_HOST_KEY = "comfyui_host";
export const COMFYUI_DEFAULT_MODEL_KEY = "comfyui_default_model";
export const COMFYUI_DEFAULT_WIDTH_KEY = "comfyui_default_width";
export const COMFYUI_DEFAULT_HEIGHT_KEY = "comfyui_default_height";
export const COMFYUI_NEGATIVE_PROMPT_KEY = "comfyui_negative_prompt";
export const SEARXNG_HOST_KEY = "searxng_host";
export const OPENROUTER_API_KEY_KEY = "openrouter_api_key";
export const DEFAULT_COMFYUI_NEGATIVE_PROMPT =
  "low quality, worst quality, blurry, watermark, signature, text, bad anatomy, deformed, ugly, duplicate, extra fingers, poorly drawn hands, poorly drawn face, mutation, cropped";
