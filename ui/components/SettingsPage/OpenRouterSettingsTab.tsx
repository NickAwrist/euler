import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { NEW_MODEL_DAYS } from "../../../src/newModels";
import { Button } from "../Button";
import { NewBadge } from "../ModelPreferenceControls";
import { ProviderIcon } from "../ModelSelectBar";
import { RefreshButton } from "../RefreshButton";
import { providerIcons } from "../modelProviders";
import { ApiKeySettingsCard } from "./ApiKeySettingsCard";
import { CatalogStatus, PublisherDialog } from "./OpenRouterPublisherDialog";
import { useApiKeySetting } from "./useApiKeySetting";
import { useOpenRouterCatalog } from "./useOpenRouterCatalog";

export function OpenRouterSettingsTab({
  onModelsChanged,
  onKeyStatusChange,
}: {
  onModelsChanged: () => Promise<void>;
  /** Reports whether a key is saved once known and after each change. */
  onKeyStatusChange?: (hasKey: boolean) => void;
}) {
  const key = useApiKeySetting("openrouter");
  const {
    data: overview,
    loading,
    error: loadError,
    load,
    change,
  } = useOpenRouterCatalog(onModelsChanged);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!key.loading) onKeyStatusChange?.(key.hasKey);
  }, [key.loading, key.hasKey, onKeyStatusChange]);
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onModelsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };
  const selectedPublisher =
    dialog === "add"
      ? "add"
      : overview?.publishers.find((publisher) => publisher.id === dialog);
  return (
    <div className="space-y-6">
      <ApiKeySettingsCard
        setting={key}
        title="OpenRouter API key"
        inputId="openrouter-key"
        placeholder="sk-or-..."
        onSaved={onModelsChanged}
      />
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
            to OpenRouter in the last {NEW_MODEL_DAYS} days.
          </p>
          {overview && <CatalogStatus catalog={overview.catalog} />}
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
                      {publisher.recentCount !== null &&
                        publisher.recentCount > 0 && <NewBadge />}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {publisher.enabledCount} enabled
                      {publisher.recentCount === null &&
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
          onClose={() => setDialog(null)}
          onChange={change}
        />
      )}
    </div>
  );
}
