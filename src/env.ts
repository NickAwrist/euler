const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_FRONTEND_PORT = 5174;
const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_COMFYUI_HOST = "http://127.0.0.1:8188";
export const DEFAULT_SEARXNG_HOST = "http://127.0.0.1:8080";

function getEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function getFirstEnv(names: string[]): string {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return "";
}

function getPort(names: string[], fallback: number): number {
  const raw = getFirstEnv(names);
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  return fallback;
}

function getBoolean(names: string[], fallback: boolean): boolean {
  const raw = getFirstEnv(names).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export const envConfig = {
  hostDirectory: getEnv("EULER_HOST_DIRECTORY"),
  backendPort: getPort(
    ["EULER_BACKEND_PORT", "BACKEND_PORT"],
    DEFAULT_BACKEND_PORT,
  ),
  backendHost:
    getFirstEnv(["EULER_BACKEND_HOST", "BACKEND_HOST"]) || DEFAULT_BACKEND_HOST,
  frontendPort: getPort(
    ["EULER_FRONTEND_PORT", "FRONTEND_PORT"],
    DEFAULT_FRONTEND_PORT,
  ),
  ollamaHost: getFirstEnv(["EULER_OLLAMA_HOST", "OLLAMA_HOST"]),
  comfyuiHost: getFirstEnv(["EULER_COMFYUI_HOST", "COMFYUI_HOST"]),
  searxngHost: getFirstEnv(["EULER_SEARXNG_HOST", "SEARXNG_HOST"]),
  jinaApiKey: getFirstEnv(["JINA_API_KEY", "EULER_JINA_API_KEY"]),
  serveFrontend: getBoolean(["EULER_SERVE_FRONTEND"], true),
  openrouterApiKey: getFirstEnv([
    "OPENROUTER_API_KEY",
    "EULER_OPENROUTER_API_KEY",
  ]),
};

/** Only expose ownership flags to the browser, never environment secrets. */
export function getEnvironmentSettings() {
  return {
    ollamaHost: Boolean(envConfig.ollamaHost),
    comfyuiHost: Boolean(envConfig.comfyuiHost),
    searxngHost: Boolean(envConfig.searxngHost),
  };
}

export type EnvironmentSettings = ReturnType<typeof getEnvironmentSettings>;
