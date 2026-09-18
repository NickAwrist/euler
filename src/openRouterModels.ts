import { z } from "zod";
import {
  InputCapability,
  type InputCapability as InputCapabilityValue,
  parseInputCapabilities,
} from "./modelCapabilities";

const TTL_MS = 2 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const RemoteModel = z.object({
  id: z.string().regex(/^[^/\s]+\/[^\s]+$/),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  created: z.number().int().nonnegative(),
  context_length: z.number().int().positive().nullish(),
  top_provider: z
    .object({ context_length: z.number().int().positive().nullish() })
    .nullish(),
  pricing: z.object({ prompt: z.unknown(), completion: z.unknown() }).nullish(),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning: z
    .object({
      mandatory: z.boolean().nullish(),
      default_enabled: z.boolean().nullish(),
      supported_efforts: z.array(z.string()).nullish(),
      default_effort: z.string().nullish(),
    })
    .nullish(),
});
const RemoteCatalog = z.object({ data: z.array(RemoteModel) });

export type ModelReasoning = {
  mandatory: boolean;
  defaultEnabled: boolean;
  supportedEfforts: string[];
  defaultEffort?: string;
};

export type CatalogModel = {
  route: string;
  publisherId: string;
  name: string;
  description: string;
  created: number;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  inputCapabilities: InputCapabilityValue[];
  supportsTools: boolean;
  outputCapabilities: string[];
  reasoning?: ModelReasoning | null;
};
export type CatalogFreshness = {
  status: "fresh" | "stale" | "unavailable";
  lastSuccessfulFetchAt: number | null;
  error: string | null;
};
export type CatalogResult = CatalogFreshness & {
  models: readonly CatalogModel[] | null;
};

function price(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || value === "")
    return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) &&
    number >= 0 &&
    Number.isFinite(number * 1_000_000)
    ? number * 1_000_000
    : null;
}
export function normalizeCatalog(payload: unknown): CatalogModel[] {
  const { data } = RemoteCatalog.parse(payload);
  if (new Set(data.map((model) => model.id)).size !== data.length)
    throw new Error("Duplicate catalog routes");
  return data.map((model) => ({
    route: model.id,
    publisherId: model.id.split("/")[0]!,
    name: model.name.replace(/^[^:]+:\s*/, ""),
    description: model.description ?? "",
    created: model.created,
    contextLength:
      model.top_provider?.context_length ?? model.context_length ?? null,
    promptPricePerMillion: price(model.pricing?.prompt),
    completionPricePerMillion: price(model.pricing?.completion),
    inputCapabilities: parseInputCapabilities(
      model.architecture.input_modalities,
    ),
    outputCapabilities: model.architecture.output_modalities,
    supportsTools: model.supported_parameters?.includes("tools") ?? false,
    reasoning: model.reasoning
      ? {
          mandatory: model.reasoning.mandatory ?? false,
          defaultEnabled: model.reasoning.default_enabled ?? false,
          supportedEfforts: model.reasoning.supported_efforts ?? [],
          defaultEffort: model.reasoning.default_effort ?? undefined,
        }
      : null,
  }));
}
/** The live catalog identifies asynchronous routes with the :batch variant. */
export function isInteractiveModel(model: CatalogModel): boolean {
  return (
    !model.route.split(":").slice(1).includes("batch") &&
    model.inputCapabilities.includes(InputCapability.Text) &&
    model.outputCapabilities.includes("text")
  );
}
export function isNewModel(created: number, now = Date.now()): boolean {
  const age = now / 1000 - created;
  return age >= 0 && age <= 21 * 24 * 60 * 60;
}
export function catalogFreshness(result: CatalogResult): CatalogFreshness {
  return {
    status: result.status,
    lastSuccessfulFetchAt: result.lastSuccessfulFetchAt,
    error: result.error,
  };
}

export class OpenRouterCatalog {
  private snapshot: {
    models: readonly CatalogModel[];
    fetchedAt: number;
  } | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<CatalogResult> | null = null;
  constructor(
    private readonly request: (
      url: string,
      init: RequestInit,
    ) => Promise<Response> = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  peek(): CatalogResult {
    return {
      models: this.snapshot?.models ?? null,
      status: !this.snapshot
        ? "unavailable"
        : this.lastError || this.now() - this.snapshot.fetchedAt >= TTL_MS
          ? "stale"
          : "fresh",
      lastSuccessfulFetchAt: this.snapshot?.fetchedAt ?? null,
      error: this.lastError,
    };
  }

  async get(force = false): Promise<CatalogResult> {
    if (this.inFlight) return this.inFlight;
    if (
      !force &&
      this.snapshot &&
      this.now() - this.snapshot.fetchedAt < TTL_MS
    ) {
      return {
        models: this.snapshot.models,
        status: this.lastError ? "stale" : "fresh",
        lastSuccessfulFetchAt: this.snapshot.fetchedAt,
        error: this.lastError,
      };
    }
    this.inFlight = this.refresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
  private async refresh(): Promise<CatalogResult> {
    try {
      const response = await this.request(
        "https://openrouter.ai/api/v1/models",
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!response.ok)
        throw new Error(
          `OpenRouter catalog request failed (${response.status})`,
        );
      const models = normalizeCatalog(await response.json());
      this.snapshot = { models, fetchedAt: this.now() };
      this.lastError = null;
      return {
        models,
        status: "fresh",
        lastSuccessfulFetchAt: this.snapshot.fetchedAt,
        error: null,
      };
    } catch {
      this.lastError = "Could not refresh the OpenRouter catalog. Try again.";
      return {
        models: this.snapshot?.models ?? null,
        status: this.snapshot ? "stale" : "unavailable",
        lastSuccessfulFetchAt: this.snapshot?.fetchedAt ?? null,
        error: this.lastError,
      };
    }
  }
}
export const openRouterCatalog = new OpenRouterCatalog();
