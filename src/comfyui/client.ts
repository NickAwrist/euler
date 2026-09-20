import WebSocket from "ws";
import { getComfyUIHost } from "../db/index";
import { DEFAULT_COMFYUI_HOST } from "../env";
import { logger } from "../logger";
import { providerHostConfig } from "../providerHostConfig";
import { errorMessage } from "../utils/errors";

export type ComfyUIPromptResponse = {
  prompt_id: string;
  number: number;
};

export type ImageGenerationResult = {
  filename: string;
  subfolder: string;
  type: string;
};

type ComfyUIWebSocketMessage = {
  type: string;
  data?: Record<string, unknown>;
};

type HistoryOutput = {
  images?: Array<{ filename: string; subfolder: string; type: string }>;
};

type HistoryEntry = {
  outputs: Record<string, HistoryOutput>;
};

type HistoryResult = Record<string, HistoryEntry>;

export class ComfyUIClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private wsClientId: string | null = null;
  private wsConnectPromise: Promise<WebSocket> | null = null;
  private messageHandlers: Map<string, (msg: ComfyUIWebSocketMessage) => void> =
    new Map();
  private serializedQueue: Promise<unknown> = Promise.resolve();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Serialize GPU/WebSocket work so concurrent image generations do not disconnect each other's WS.
   */
  runSerialized<T>(task: () => Promise<T>, label?: string): Promise<T> {
    const log = logger.child({ component: "ComfyUIClient" });
    const enteredAt = Date.now();
    const next = this.serializedQueue.then(async () => {
      const startedAt = Date.now();
      log.debug({
        event: "comfy_queue_start",
        label,
        queueWaitMs: startedAt - enteredAt,
      });
      try {
        return await task();
      } finally {
        log.debug({
          event: "comfy_queue_done",
          label,
          runMs: Date.now() - startedAt,
        });
      }
    });
    this.serializedQueue = next.catch(() => {});
    return next as Promise<T>;
  }

  private get wsUrl(): string {
    const httpUrl = new URL(this.baseUrl);
    const wsProtocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${httpUrl.host}/ws`;
  }

  async queuePrompt(
    workflow: Record<string, unknown>,
    clientId: string,
  ): Promise<ComfyUIPromptResponse> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ComfyUI prompt failed: ${response.status} - ${errorText}`,
      );
    }
    return response.json() as Promise<ComfyUIPromptResponse>;
  }

  async getHistory(promptId: string): Promise<HistoryResult> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`);
    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.status}`);
    }
    return response.json() as Promise<HistoryResult>;
  }

  async healthCheck(
    timeoutMs = 5000,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
      };
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/object_info/CheckpointLoaderSimple`,
      );
      if (!response.ok) return [];
      const data = (await response.json()) as Record<string, unknown>;
      const info = data?.CheckpointLoaderSimple as
        | Record<string, unknown>
        | undefined;
      const input = info?.input as Record<string, unknown> | undefined;
      const required = input?.required as Record<string, unknown> | undefined;
      const ckptName = required?.ckpt_name as unknown[] | undefined;
      const checkpoints = ckptName?.[0];
      if (Array.isArray(checkpoints) && checkpoints.length > 0) {
        return checkpoints as string[];
      }
      return [];
    } catch {
      return [];
    }
  }

  connectWebSocket(clientId: string): Promise<WebSocket> {
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.wsClientId === clientId
    ) {
      return Promise.resolve(this.ws);
    }
    if (this.wsConnectPromise && this.wsClientId === clientId) {
      return this.wsConnectPromise;
    }
    if (this.ws && this.wsClientId !== clientId) {
      this.disconnect();
    }

    this.wsClientId = clientId;
    const connectPromise: Promise<WebSocket> = new Promise<WebSocket>(
      (resolve, reject) => {
        const wsUrlWithClient = `${this.wsUrl}?clientId=${clientId}`;
        const ws = new WebSocket(wsUrlWithClient);
        this.ws = ws;

        ws.on("open", () => resolve(ws));
        ws.on("message", (data: WebSocket.Data) => {
          try {
            const message: ComfyUIWebSocketMessage = JSON.parse(
              data.toString(),
            );
            for (const handler of this.messageHandlers.values()) {
              handler(message);
            }
          } catch {
            // ignore unparseable messages
          }
        });
        ws.on("error", (error) => reject(error));
        ws.on("close", () => {
          if (this.ws === ws) {
            this.ws = null;
            this.wsClientId = null;
          }
        });
      },
    ).finally(() => {
      this.wsConnectPromise = null;
    });

    this.wsConnectPromise = connectPromise;
    return connectPromise;
  }

  waitForPrompt(
    promptId: string,
    timeoutMs = 300000,
  ): Promise<ImageGenerationResult[]> {
    return new Promise((resolve, reject) => {
      const handlerId = `wait-${promptId}`;
      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for prompt ${promptId}`));
      }, timeoutMs);

      const cleanup = () => {
        this.messageHandlers.delete(handlerId);
        clearTimeout(timeoutHandle);
      };

      this.messageHandlers.set(handlerId, async (msg) => {
        if (
          msg.type === "executing" &&
          msg.data?.prompt_id === promptId &&
          msg.data?.node === null
        ) {
          cleanup();
          try {
            const history = await this.getHistory(promptId);
            const promptHistory = history[promptId];
            if (!promptHistory) {
              reject(new Error("No history found for prompt"));
              return;
            }
            const images: ImageGenerationResult[] = [];
            for (const output of Object.values(promptHistory.outputs)) {
              if (output.images) {
                for (const img of output.images) {
                  images.push({
                    filename: img.filename,
                    subfolder: img.subfolder,
                    type: img.type,
                  });
                }
              }
            }
            resolve(images);
          } catch (error) {
            reject(error);
          }
        } else if (
          msg.type === "execution_error" &&
          msg.data?.prompt_id === promptId
        ) {
          cleanup();
          reject(new Error("Execution error in ComfyUI"));
        }
      });
    });
  }

  getImageUrl(filename: string, subfolder?: string, type = "output"): string {
    const params = new URLSearchParams({ filename, type });
    if (subfolder) params.set("subfolder", subfolder);
    return `${this.baseUrl}/view?${params.toString()}`;
  }

  async fetchViewAsset(
    filename: string,
    subfolder?: string,
    type = "output",
  ): Promise<Response> {
    const url = this.getImageUrl(filename, subfolder, type);
    return fetch(url);
  }

  disconnect(): void {
    this.wsConnectPromise = null;
    this.wsClientId = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let clientInstance: ComfyUIClient | null = null;
let cachedHost: string | null = null;

export function getComfyUIClient(): ComfyUIClient {
  const host = getResolvedComfyUIHost();
  if (!clientInstance || cachedHost !== host) {
    clientInstance?.disconnect();
    clientInstance = new ComfyUIClient(host);
    cachedHost = host;
  }
  return clientInstance;
}

export function invalidateComfyUIClient(): void {
  clientInstance?.disconnect();
  clientInstance = null;
  cachedHost = null;
}

export function getResolvedComfyUIHost(): string {
  return getComfyUIHostConfig().effectiveHost;
}

export function getComfyUIHostConfig(): {
  host: string;
  effectiveHost: string;
} {
  return providerHostConfig({
    host: getComfyUIHost(),
    fallbackHost: DEFAULT_COMFYUI_HOST,
    normalize: (host) => host.replace(/\/+$/, ""),
  });
}
