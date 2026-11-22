import { useCallback, useEffect, useState } from "react";
import { ImageProvider } from "../../../src/gen/euler/v1/preferences_pb";
import {
  ApiKeyProvider,
  type ImageModel,
} from "../../../src/gen/euler/v1/providers_pb";
import { loadImageModels } from "../../persist/services";
import { cx, eyebrowText } from "../../styles";
import { RefreshButton } from "../RefreshButton";
import { hintClass, labelClass, selectClass } from "./constants";
import { useApiKeySetting } from "./useApiKeySetting";

const PROVIDER_LABELS: Record<ImageProvider, string> = {
  [ImageProvider.UNSPECIFIED]: "Auto",
  [ImageProvider.OPENROUTER]: "OpenRouter",
  [ImageProvider.VERCEL_GATEWAY]: "Vercel AI Gateway",
};

const PROVIDER_SLUGS: Record<ImageProvider, string> = {
  [ImageProvider.UNSPECIFIED]: "auto",
  [ImageProvider.OPENROUTER]: "openrouter",
  [ImageProvider.VERCEL_GATEWAY]: "vercel_gateway",
};

const PROVIDER_BY_SLUG: Record<string, ImageProvider> = {
  auto: ImageProvider.UNSPECIFIED,
  openrouter: ImageProvider.OPENROUTER,
  vercel_gateway: ImageProvider.VERCEL_GATEWAY,
};

function keyStatus(setting: { loading: boolean; hasKey: boolean }): string {
  if (setting.loading) return "checking...";
  return setting.hasKey ? "configured" : "not configured";
}

async function fetchImageModelsList(
  provider: ImageProvider,
  refresh: boolean,
): Promise<{ models: ImageModel[] | null; error: string | null }> {
  try {
    const result = await loadImageModels(provider, refresh);
    return { models: result.models, error: result.error ?? null };
  } catch (error) {
    return {
      models: null,
      error: error instanceof Error ? error.message : "Failed to load models",
    };
  }
}

type Props = {
  provider: ImageProvider;
  model: string;
  onProviderChange: (provider: ImageProvider) => void;
  onModelChange: (model: string) => void;
};

export function ImageGenerationTab({
  provider,
  model,
  onProviderChange,
  onModelChange,
}: Props) {
  const openRouterKey = useApiKeySetting(ApiKeyProvider.OPENROUTER);
  const vercelKey = useApiKeySetting(ApiKeyProvider.VERCEL_GATEWAY);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const effectiveProvider =
    provider !== ImageProvider.UNSPECIFIED
      ? provider
      : openRouterKey.hasKey
        ? ImageProvider.OPENROUTER
        : vercelKey.hasKey
          ? ImageProvider.VERCEL_GATEWAY
          : ImageProvider.UNSPECIFIED;

  const fetchModels = useCallback(
    async (refresh = false) => {
      setLoadingModels(true);
      setModelsError(null);
      const result = await fetchImageModelsList(effectiveProvider, refresh);
      if (result.models !== null) setModels(result.models);
      setModelsError(result.error);
      setLoadingModels(false);
    },
    [effectiveProvider],
  );

  useEffect(() => {
    if (openRouterKey.loading || vercelKey.loading) return;
    void fetchModels(false);
  }, [fetchModels, openRouterKey.loading, vercelKey.loading]);

  const showProviderPrefix = effectiveProvider === ImageProvider.UNSPECIFIED;
  const hasSavedModel = model !== "" && !models.some((m) => m.id === model);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className={cx(eyebrowText, "mb-4")}>Image Generation</h2>

        <div className="space-y-2">
          <label htmlFor="imageProvider" className={labelClass}>
            Provider
          </label>
          <select
            id="imageProvider"
            value={PROVIDER_SLUGS[provider]}
            onChange={(event) =>
              onProviderChange(
                PROVIDER_BY_SLUG[event.target.value] ??
                  ImageProvider.UNSPECIFIED,
              )
            }
            className={selectClass}
          >
            <option value="auto">Auto (first configured)</option>
            <option value="openrouter">OpenRouter</option>
            <option value="vercel_gateway">Vercel AI Gateway</option>
          </select>
          <p className={hintClass}>
            Uses API keys from Settings &gt; OpenRouter (
            {keyStatus(openRouterKey)}) and Settings &gt; Vercel AI Gateway (
            {keyStatus(vercelKey)}).
          </p>
        </div>

        <hr className="border-border-subtle" />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="imageModel" className={labelClass}>
              Default model
            </label>
            <RefreshButton
              label="Refresh image models"
              refreshing={loadingModels}
              iconOnly
              onClick={() => void fetchModels(true)}
            />
          </div>
          <select
            id="imageModel"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className={selectClass}
          >
            <option value="">Auto (first available)</option>
            {hasSavedModel && <option value={model}>{model}</option>}
            {models.map((entry) => (
              <option key={`${entry.provider}:${entry.id}`} value={entry.id}>
                {showProviderPrefix
                  ? `${PROVIDER_LABELS[entry.provider]}: ${entry.name}`
                  : entry.name}
              </option>
            ))}
          </select>
          {modelsError && (
            <p role="alert" className="text-xs text-destructive">
              {modelsError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
