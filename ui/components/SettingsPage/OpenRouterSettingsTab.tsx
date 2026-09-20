import { KeyRound, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { modelSettingsRequest } from "../../lib/modelSettingsRequest";
import { Button } from "../Button";
import { NewBadge } from "../ModelPreferenceControls";
import { ProviderIcon } from "../ModelSelectBar";
import { RefreshButton } from "../RefreshButton";
import { providerIcons } from "../modelProviders";
import { EnvironmentSettingHint } from "./EnvironmentSettingHint";
import { CatalogStatus, PublisherDialog } from "./OpenRouterPublisherDialog";
import { inputClass, labelClass } from "./constants";
import { useOpenRouterCatalog } from "./useOpenRouterCatalog";

export function OpenRouterSettingsTab({
  onModelsChanged,
}: { onModelsChanged: () => Promise<void> }) {
  const [environmentManaged, setEnvironmentManaged] = useState<boolean>();
  const [hasKey, setHasKey] = useState(false);
  const [keyLoading, setKeyLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
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
    let active = true;
    void modelSettingsRequest<{ hasKey: boolean; environmentManaged: boolean }>(
      "openrouter",
    )
      .then((key) => {
        if (!active) return;
        setHasKey(key.hasKey);
        setEnvironmentManaged(key.environmentManaged);
      })
      .catch(() => {
        if (active) setError("Could not load API key settings.");
      })
      .finally(() => {
        if (active) setKeyLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
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
      <section className="rounded-xl border border-border-subtle bg-card px-5 py-4">
        <h2 className="mb-4 flex items-center gap-2 font-medium">
          <KeyRound size={18} /> OpenRouter API key{" "}
          <span
            className={`ml-auto text-sm ${!keyLoading && hasKey ? "text-emerald-500/90" : "text-muted-foreground"}`}
          >
            {keyLoading
              ? "Loading..."
              : hasKey
                ? "Configured"
                : "Not configured"}
          </span>
        </h2>
        {!keyLoading && hasKey && !editingKey && !environmentManaged && (
          <Button
            variant="secondary"
            disabled={environmentManaged !== false}
            onClick={() => setEditingKey(true)}
          >
            Update key
          </Button>
        )}
        {!keyLoading && (!hasKey || editingKey || environmentManaged) && (
          <>
            <label className={labelClass} htmlFor="openrouter-key">
              API key
            </label>
            <input
              id="openrouter-key"
              aria-describedby={
                environmentManaged ? "openrouter-environment" : undefined
              }
              type="password"
              autoComplete="off"
              value={environmentManaged ? "••••••••" : apiKey}
              disabled={environmentManaged !== false}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "Enter a replacement key" : "sk-or-..."}
              className={inputClass}
            />
            {!environmentManaged && (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  disabled={
                    environmentManaged !== false || busy || !apiKey.trim()
                  }
                  loading={busy}
                  onClick={() =>
                    void mutate(async () => {
                      const result = await modelSettingsRequest<{
                        hasKey: boolean;
                      }>("openrouter", "PUT", { apiKey });
                      setHasKey(result.hasKey);
                      setApiKey("");
                      setEditingKey(false);
                    })
                  }
                >
                  Save key
                </Button>
                {hasKey && (
                  <Button
                    variant="secondary"
                    disabled={environmentManaged !== false || busy}
                    onClick={() =>
                      void mutate(async () => {
                        await modelSettingsRequest("openrouter", "PUT", {
                          apiKey: "",
                        });
                        setHasKey(false);
                        setApiKey("");
                        setEditingKey(false);
                        setDialog(null);
                      })
                    }
                  >
                    Remove key
                  </Button>
                )}
                {hasKey && (
                  <Button
                    variant="secondary"
                    disabled={environmentManaged !== false || busy}
                    onClick={() => {
                      setApiKey("");
                      setEditingKey(false);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {environmentManaged && (
          <EnvironmentSettingHint
            id="openrouter-environment"
            managed={environmentManaged}
          />
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hasKey && (
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
            Choose which models appear in the composer.
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
          <div className="grid gap-x-3 gap-y-5 pt-3 sm:grid-cols-2">
            {overview?.publishers
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .map((publisher) => (
                <button
                  key={publisher.id}
                  type="button"
                  aria-label={`${publisher.name}, ${publisher.enabledCount} enabled${publisher.recentCount ? ", new models available" : ""}`}
                  className="relative flex items-center gap-3 rounded-xl border border-border-subtle p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent-ring"
                  onClick={() => setDialog(publisher.id)}
                >
                  {publisher.recentCount !== null &&
                    publisher.recentCount > 0 && (
                      <NewBadge className="absolute -top-2.5 left-3" />
                    )}
                  <ProviderIcon
                    provider={{
                      id: publisher.id,
                      name: publisher.name,
                      iconUrl: providerIcons[publisher.id],
                      models: [],
                    }}
                  />
                  <span>
                    <span className="block font-medium">{publisher.name}</span>
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
      {hasKey && selectedPublisher && overview && (
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
