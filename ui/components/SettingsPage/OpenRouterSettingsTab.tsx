import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ModelProvider } from "../../../src/gen/euler/v1/models_pb";
import { ApiKeyProvider } from "../../../src/gen/euler/v1/providers_pb";
import { NEW_MODEL_DAYS } from "../../../src/models/newModels";
import { whileRunning } from "../../lib/whileRunning";
import { Button } from "../Button";
import { NewBadge } from "../ModelPreferenceControls";
import { ProviderIcon } from "../ModelSelectBar";
import { RefreshButton } from "../RefreshButton";
import { providerIcons } from "../modelProviders";
import { ApiKeySettingsCard } from "./ApiKeySettingsCard";
import { ProviderBalanceCard } from "./OpenRouterBalanceCard";
import { CatalogStatus, PublisherDialog } from "./OpenRouterPublisherDialog";
import { useApiKeySetting } from "./useApiKeySetting";
import { useGatewayCatalog } from "./useOpenRouterCatalog";

type GatewayTabConfig = {
  label: string;
  apiKeyProvider: ApiKeyProvider;
  apiKeyTitle: string;
  inputId: string;
  placeholder: string;
};

const GATEWAY_CONFIG: Record<
  ModelProvider.OPENROUTER | ModelProvider.VERCEL_GATEWAY,
  GatewayTabConfig
> = {
  [ModelProvider.OPENROUTER]: {
    label: "OpenRouter",
    apiKeyProvider: ApiKeyProvider.OPENROUTER,
    apiKeyTitle: "OpenRouter API key",
    inputId: "openrouter-key",
    placeholder: "sk-or-...",
  },
  [ModelProvider.VERCEL_GATEWAY]: {
    label: "Vercel AI Gateway",
    apiKeyProvider: ApiKeyProvider.VERCEL_GATEWAY,
    apiKeyTitle: "Vercel AI Gateway API key",
    inputId: "vercel-gateway-key",
    placeholder: "vck_...",
  },
};

export function GatewaySettingsTab({
  provider,
  onModelsChanged,
  onKeyStatusChange,
}: {
  provider: ModelProvider.OPENROUTER | ModelProvider.VERCEL_GATEWAY;
  onModelsChanged: () => Promise<void>;
  /** Reports whether a key is saved once known and after each change. */
  onKeyStatusChange?: (hasKey: boolean) => void;
}) {
  const config = GATEWAY_CONFIG[provider];
  const key = useApiKeySetting(config.apiKeyProvider);
  const [keyRevision, setKeyRevision] = useState(0);
  const {
    data: overview,
    loading,
    error: loadError,
    load,
    change,
  } = useGatewayCatalog(provider, onModelsChanged);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!key.loading) onKeyStatusChange?.(key.hasKey);
  }, [key.loading, key.hasKey, onKeyStatusChange]);
  const mutate = (action: () => Promise<void>) =>
    whileRunning(setBusy, async () => {
      setError(null);
      try {
        await action();
        await onModelsChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  const refresh = () => whileRunning(setRefreshing, () => load(true));
  const selectedPublisher =
    dialog === "add"
      ? "add"
      : overview?.publishers.find((publisher) => publisher.id === dialog);
  return (
    <div className="space-y-6">
      <ApiKeySettingsCard
        setting={key}
        title={config.apiKeyTitle}
        inputId={config.inputId}
        placeholder={config.placeholder}
        onSaved={async () => {
          setKeyRevision((value) => value + 1);
          await onModelsChanged();
        }}
      />
      {key.hasKey && (
        <ProviderBalanceCard key={keyRevision} provider={provider} />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {key.hasKey && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-medium">Publishers</h2>
            <RefreshButton
              label="Refresh catalog"
              refreshing={refreshing}
              disabled={busy}
              onClick={() => void mutate(refresh)}
            />
            <Button
              variant="primary"
              icon={Plus}
              disabled={loading || !overview}
              onClick={() => setDialog("add")}
            >
              Add publisher
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Choose which models appear in the composer. New marks models added
            to {config.label} in the last {NEW_MODEL_DAYS} days.
          </p>
          {overview?.freshness && (
            <CatalogStatus catalog={overview.freshness} />
          )}
          {loadError && (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          )}
          {loading && <output>Loading publishers...</output>}
          {!loading && !overview && (
            <Button
              variant="secondary"
              onClick={() => void mutate(() => load())}
            >
              Retry settings
            </Button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {overview?.publishers
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .map((publisher) => (
                <button
                  key={publisher.id}
                  type="button"
                  aria-label={`${publisher.name}, ${publisher.enabledCount} enabled${publisher.recentCount ? ", new models available" : ""}`}
                  className="flex items-center gap-3 rounded-xl border border-border-subtle p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent-ring"
                  onClick={() => setDialog(publisher.id)}
                >
                  <ProviderIcon
                    provider={{
                      id: publisher.id,
                      name: publisher.name,
                      iconUrl: providerIcons[publisher.id],
                      models: [],
                    }}
                  />
                  <span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{publisher.name}</span>
                      {publisher.recentCount !== undefined &&
                        publisher.recentCount > 0 && <NewBadge />}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {publisher.enabledCount} enabled
                      {publisher.recentCount === undefined &&
                        " · Recent count unavailable"}
                      {publisher.subscribed ? " · Subscribed" : ""}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
      {key.hasKey && selectedPublisher && overview && (
        <PublisherDialog
          publisher={selectedPublisher}
          data={overview}
          providerLabel={config.label}
          onClose={() => setDialog(null)}
          onChange={change}
        />
      )}
    </div>
  );
}

export function OpenRouterSettingsTab(props: {
  onModelsChanged: () => Promise<void>;
  onKeyStatusChange?: (hasKey: boolean) => void;
}) {
  return <GatewaySettingsTab provider={ModelProvider.OPENROUTER} {...props} />;
}
