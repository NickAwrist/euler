import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { comparePublisherModels } from "../../../src/modelSort";
import type { CatalogFreshness } from "../../../src/openRouterModels";
import { Button } from "../Button";
import { Modal } from "../Modal";
import {
  ModelCapabilityBadges,
  formatContextLength,
} from "../ModelCapabilityBadges";
import {
  EnableSwitch,
  FavoriteButton,
  NewBadge,
  PreferenceNotice,
} from "../ModelPreferenceControls";
import { ProviderIcon } from "../ModelSelectBar";
import { providerIcons } from "../modelProviders";
import { inputClass } from "./constants";
import type {
  CatalogSettings,
  PreferenceChange,
  Publisher,
  PublisherModel,
} from "./useOpenRouterCatalog";

export function CatalogStatus({ catalog }: { catalog: CatalogFreshness }) {
  return (
    <output className="text-xs text-muted-foreground">
      {catalog.status === "stale" &&
        "Refresh failed. Showing the last known catalog. "}
      {catalog.status === "unavailable" &&
        "Catalog unavailable. Saved models have unverified availability. "}
      {catalog.lastSuccessfulFetchAt !== null &&
        `Last updated ${new Date(catalog.lastSuccessfulFetchAt).toLocaleString()}.`}
    </output>
  );
}
function rate(value: number | null) {
  return value === null
    ? "Unknown"
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}
function modelDetails(model: PublisherModel): string[] {
  const details: string[] = [];
  if (model.availability === "unavailable") details.push("Unavailable");
  if (model.availability === "unverified")
    details.push("Availability unverified");
  if (model.contextLength !== null)
    details.push(formatContextLength(model.contextLength));
  if (
    model.promptPricePerMillion !== null ||
    model.completionPricePerMillion !== null
  )
    details.push(
      `${rate(model.promptPricePerMillion)} in / ${rate(model.completionPricePerMillion)} out`,
    );
  return details;
}
export function PublisherDialog({
  publisher,
  data,
  onClose,
  onChange,
}: {
  publisher: Publisher | "add";
  data: CatalogSettings;
  onClose: () => void;
  onChange: (change: PreferenceChange) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const busy = pending.has("remove");
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const mutate = async (change: PreferenceChange) => {
    const key =
      change.kind === "favorite" || change.kind === "enabled"
        ? `${change.kind}:${change.route}`
        : change.kind === "track"
          ? `track:${change.publisherId}`
          : change.kind;
    setPending((current) => new Set(current).add(key));
    setNotice(null);
    try {
      await onChange(change);
      if (change.kind === "remove") onClose();
      if (change.kind === "add-model") setSlug("");
    } catch (cause) {
      setNotice(
        change.kind === "add-model" && cause instanceof Error
          ? cause.message
          : change.kind === "remove"
            ? "Couldn't remove publisher. Try again."
            : "Couldn't save change. Try again.",
      );
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const search = query.trim().toLowerCase();
  const models =
    publisher === "add" ? [] : (data.modelsByPublisher[publisher.id] ?? []);
  const visible = models
    .filter((model) =>
      `${model.name} ${model.route}`.toLowerCase().includes(search),
    )
    .sort(comparePublisherModels);
  const publishers =
    data.discoveredPublishers
      ?.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(search),
      )
      .sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  return (
    <Modal
      title={publisher === "add" ? "Add publisher" : publisher.name}
      ariaLabelledBy="publisher-dialog-title"
      closeLabel="Close publisher dialog"
      onClose={onClose}
      busy={busy}
      maxWidthClass="max-w-3xl"
      layout="flex"
      surfaceClassName="h-[min(42rem,85dvh)] overflow-hidden shadow-xl"
    >
      <div className="shrink-0 space-y-3 border-b border-border-subtle p-4">
        {publisher !== "add" && (
          <div>
            <div className="flex items-center gap-2">
              <EnableSwitch
                label="Auto-enable new models"
                checked={publisher.subscribed}
                disabled={busy || pending.has("subscription")}
                onChange={(value) =>
                  void mutate({
                    kind: "subscription",
                    publisherId: publisher.id,
                    value,
                  })
                }
              />
              <span className="text-sm">Auto-enable new models</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Automatically enable future OpenRouter listings. Models you
              disable stay disabled.
            </p>
          </div>
        )}
        {publisher === "add" && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const route = slug.trim();
              if (!route || pending.has("add-model")) return;
              void mutate({
                kind: "add-model",
                publisherId: route.split("/")[0]!,
                route,
              });
            }}
          >
            <label
              htmlFor="openrouter-model-slug"
              className="text-sm font-medium"
            >
              Add model by slug
            </label>
            <div className="flex gap-2">
              <input
                id="openrouter-model-slug"
                className={`${inputClass} min-w-0 flex-1`}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="cohere/command-a"
                required
              />
              <Button
                type="submit"
                size="sm"
                disabled={!slug.trim() || pending.has("add-model")}
                loading={pending.has("add-model")}
                className="shrink-0"
              >
                Add model
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Adds its publisher and enables this model.
            </p>
          </form>
        )}
        <input
          type="search"
          aria-label={
            publisher === "add" ? "Search publishers" : "Search models"
          }
          className={inputClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            publisher === "add"
              ? "Search publishers..."
              : "Search model name or route..."
          }
        />
        {data.catalog.status !== "fresh" && (
          <CatalogStatus catalog={data.catalog} />
        )}
        {publisher !== "add" && (
          <p className="text-xs text-muted-foreground">
            Catalog base token rates per million tokens. Total cost may vary.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {publisher === "add" ? (
          <div className="space-y-2">
            {publishers.map((item) => (
              <Button
                key={item.id}
                variant="secondary"
                disabled={
                  busy || pending.has(`track:${item.id}`) || item.tracked
                }
                loading={pending.has(`track:${item.id}`)}
                className="w-full justify-start"
                onClick={() =>
                  void mutate({ kind: "track", publisherId: item.id })
                }
              >
                <ProviderIcon
                  provider={{
                    ...item,
                    iconUrl: providerIcons[item.id],
                    models: [],
                  }}
                />
                {item.name}
                <span className="ml-auto">
                  {item.tracked ? "Added" : "Add"}
                </span>
              </Button>
            ))}
            {publishers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {data.catalog.status === "unavailable"
                  ? "Publishers unavailable. Refresh the catalog from settings."
                  : "No matching publishers."}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((model) => (
              <article
                key={model.route}
                className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium">
                      {model.name}
                    </h3>
                    {model.isNew && <NewBadge />}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="wrap-anywhere">
                      {[model.route, ...modelDetails(model)].join(" · ")}
                    </span>
                    <ModelCapabilityBadges model={model} />
                  </p>
                </div>
                <FavoriteButton
                  name={model.name}
                  favorite={model.favorite}
                  disabled={busy || pending.has(`favorite:${model.route}`)}
                  onClick={() =>
                    void mutate({
                      kind: "favorite",
                      publisherId: publisher.id,
                      route: model.route,
                      value: !model.favorite,
                    })
                  }
                />
                <div className="flex h-9 items-center">
                  <EnableSwitch
                    label={`Enable ${model.name}`}
                    checked={model.enabled}
                    disabled={
                      busy ||
                      pending.has(`enabled:${model.route}`) ||
                      (!model.enabled && model.availability !== "available")
                    }
                    onChange={(value) =>
                      void mutate({
                        kind: "enabled",
                        publisherId: publisher.id,
                        route: model.route,
                        value,
                      })
                    }
                  />
                </div>
              </article>
            ))}
            {visible.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {data.catalog.status === "unavailable"
                  ? "Catalog unavailable. No saved selections for this publisher."
                  : "No matching interactive models."}
              </p>
            )}
          </div>
        )}
      </div>
      {publisher !== "add" && (
        <footer className="flex shrink-0 items-center gap-4 border-t border-border-subtle px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            disabled={pending.size > 0}
            loading={pending.has("remove")}
            className="flex shrink-0 items-center gap-2 py-1 text-xs text-muted-foreground hover:text-destructive"
            onClick={() =>
              void mutate({ kind: "remove", publisherId: publisher.id })
            }
          >
            Remove publisher
          </Button>
          <p className="text-xs text-muted-foreground">
            Disables its models and stops auto-enable. Favorites are kept.
          </p>
        </footer>
      )}
      <PreferenceNotice message={notice} onDismiss={dismissNotice} />
    </Modal>
  );
}
