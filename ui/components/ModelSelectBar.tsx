import { Check, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { compareModels } from "../../src/modelSort";
import { modelSettingsRequest } from "../lib/modelSettingsRequest";
import { navigate } from "../lib/navigation";
import { cx } from "../styles";
import type { ModelOption } from "../types";
import { AnchoredPopover } from "./AnchoredPopover";
import {
  ModelCapabilityBadges,
  formatContextLength,
  modelCapabilities,
} from "./ModelCapabilityBadges";
import { FavoriteButton, NewBadge } from "./ModelPreferenceControls";
import { type ModelProvider, groupModelProviders } from "./modelProviders";

function isMonochromeProviderIcon(url: string): boolean {
  return (
    url.endsWith("/openai.svg") ||
    url.endsWith("/xai.svg") ||
    url.endsWith("/moonshot.svg") ||
    url === "/icons/ollama.svg"
  );
}

function modelDetails(model: ModelOption): string {
  const details: string[] = [];
  if (model.configured === false) details.push("Setup required");
  if (model.availability === "unverified")
    details.push("Availability unverified");
  if (model.contextLength)
    details.push(formatContextLength(model.contextLength));
  if (modelCapabilities(model).length === 0) details.push("Chat only");
  return details.join(" · ");
}

function isUnconfigured(model: ModelOption): boolean {
  return model.provider === "openrouter" && model.configured === false;
}

export function ProviderIcon({ provider }: { provider: ModelProvider }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (provider.iconUrl && failedUrl !== provider.iconUrl) {
    return (
      <img
        src={provider.iconUrl}
        alt=""
        className={cx(
          "size-5 shrink-0 object-contain",
          isMonochromeProviderIcon(provider.iconUrl) && "invert",
        )}
        onError={() => setFailedUrl(provider.iconUrl)}
      />
    );
  }
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center text-xs font-semibold"
      aria-hidden
    >
      {provider.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ModelSelectBar({
  ollamaModels,
  ollamaConnected,
  modelsLoadError,
  selectedModel,
  onModelChange,
  disabled,
}: {
  ollamaModels: ModelOption[];
  ollamaConnected: boolean | null;
  modelsLoadError: string | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled: boolean;
}) {
  const menuId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("");
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [favoritePending, setFavoritePending] = useState<Set<string>>(
    new Set(),
  );
  const [favoriteOverrides, setFavoriteOverrides] = useState<
    Record<string, boolean>
  >({});
  useEffect(
    () =>
      setFavoriteOverrides((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([id, value]) =>
              ollamaModels.find((model) => model.id === id)?.favorite !== value,
          ),
        ),
      ),
    [ollamaModels],
  );
  const displayModels = useMemo(
    () =>
      ollamaModels.map((model) => ({
        ...model,
        favorite: favoriteOverrides[model.id] ?? model.favorite,
      })),
    [ollamaModels, favoriteOverrides],
  );
  const providers = useMemo(
    () => [
      {
        id: "favorites",
        name: "Favorites",
        models: displayModels
          .filter((model) => model.favorite && model.configured !== false)
          .sort(compareModels),
      },
      ...groupModelProviders(displayModels),
    ],
    [displayModels],
  );
  const selectedProvider = providers
    .slice(1)
    .find((provider) =>
      provider.models.some((model) => model.id === selectedModel),
    );
  const selected = ollamaModels.find((model) => model.id === selectedModel);
  const provider =
    providers.find((item) => item.id === providerId) ??
    selectedProvider ??
    providers[0];
  const models = (provider?.models ?? []).filter((model) =>
    `${model.name} ${model.route ?? model.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const statusLabel = modelsLoadError
    ? "Models unavailable"
    : ollamaConnected === null
      ? "Checking models..."
      : ollamaConnected === false
        ? "Model provider disconnected"
        : "No models found";
  const label =
    selected?.name ??
    (selectedModel
      ? `${selectedModel.replace(/^openrouter:/, "")} (unavailable)`
      : statusLabel);

  return (
    <AnchoredPopover
      id={menuId}
      disabled={disabled}
      ariaLabel="Choose model"
      containerClassName="min-w-0 max-w-[60%]"
      panelClassName="model-picker"
      maxHeight={320}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          setQuery("");
          setProviderId(
            (current) => current || selectedProvider?.id || "favorites",
          );
        }
      }}
      onOpen={() => {
        if (window.matchMedia("(hover: hover)").matches)
          searchRef.current?.focus();
      }}
      renderTrigger={({ ref, popoverTarget, isOpen }) => (
        <button
          ref={ref}
          id="run-model"
          type="button"
          popoverTarget={popoverTarget}
          aria-label={`Model: ${label}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={popoverTarget}
          disabled={disabled}
          title={modelsLoadError ?? label}
          className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-45"
        >
          {selectedProvider && <ProviderIcon provider={selectedProvider} />}
          <span className="truncate">{label}</span>
          <ChevronDown
            size={12}
            className={cx(
              "shrink-0 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      )}
    >
      {({ close, panelRef }) => (
        <div className="flex h-full min-h-0">
          <div
            role="tablist"
            aria-label="Model groups"
            aria-orientation="vertical"
            className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border-subtle p-1.5"
          >
            {providers.map((item, index) => (
              <button
                key={item.id}
                id={`${menuId}-provider-${index}`}
                type="button"
                role="tab"
                aria-label={item.name}
                aria-selected={item.id === provider?.id}
                aria-controls={`${menuId}-models`}
                tabIndex={item.id === provider?.id ? 0 : -1}
                title={item.name}
                className={cx(
                  "relative flex min-h-11 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent-ring",
                  item.id === provider?.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                onClick={() => {
                  setProviderId(item.id);
                  setQuery("");
                }}
                onKeyDown={(event) => {
                  const nextIndex =
                    event.key === "ArrowDown"
                      ? (index + 1) % providers.length
                      : event.key === "ArrowUp"
                        ? (index - 1 + providers.length) % providers.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? providers.length - 1
                            : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const next = providers[nextIndex];
                  if (next) {
                    setProviderId(next.id);
                    setQuery("");
                    document
                      .getElementById(`${menuId}-provider-${nextIndex}`)
                      ?.focus();
                  }
                }}
              >
                {item.id === "favorites" ? (
                  <Star
                    size={20}
                    className="fill-[#c6ad65] text-[#c6ad65]"
                    aria-hidden
                  />
                ) : (
                  <ProviderIcon provider={item} />
                )}
              </button>
            ))}
          </div>
          <div
            id={`${menuId}-models`}
            role="tabpanel"
            aria-labelledby={`${menuId}-provider-${provider ? providers.indexOf(provider) : 0}`}
            className="flex min-w-0 flex-1 flex-col"
          >
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <Search
                size={16}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={`Search ${provider?.name ?? "provider"} models`}
                placeholder="Search models..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const match = models.find(
                      (model) => !isUnconfigured(model),
                    );
                    if (match && !disabled) {
                      onModelChange(match.id);
                      close();
                    }
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    panelRef.current
                      ?.querySelector<HTMLButtonElement>(
                        "[data-model-option]:not(:disabled)",
                      )
                      ?.focus();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between px-3 pb-1 pt-3 text-xs text-muted-foreground">
              <span>{provider?.name}</span>
              <span>{models.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {favoriteError && (
                <p role="alert" className="px-3 py-2 text-sm text-destructive">
                  {favoriteError}
                </p>
              )}
              {models.map((model) => (
                <div key={model.id} className="flex items-center">
                  <button
                    type="button"
                    data-model-option
                    aria-pressed={selectedModel === model.id}
                    disabled={disabled || isUnconfigured(model)}
                    className={cx(
                      "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-40",
                      selectedModel === model.id
                        ? "bg-muted text-foreground"
                        : "hover:bg-muted/60",
                    )}
                    onClick={() => {
                      onModelChange(model.id);
                      close();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return;
                      event.preventDefault();
                      const options = Array.from(
                        panelRef.current?.querySelectorAll<HTMLButtonElement>(
                          "[data-model-option]:not(:disabled)",
                        ) ?? [],
                      );
                      const index = options.indexOf(event.currentTarget);
                      options[
                        (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          options.length) %
                          options.length
                      ]?.focus();
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-medium"
                        title={model.name}
                      >
                        {model.name}
                        {model.isNew && (
                          <NewBadge className="ml-2 inline-block align-middle" />
                        )}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        {modelDetails(model)}
                        <ModelCapabilityBadges model={model} />
                      </span>
                    </span>
                    {selectedModel === model.id && (
                      <Check size={15} className="shrink-0" aria-hidden />
                    )}
                  </button>
                  <FavoriteButton
                    name={model.name}
                    favorite={model.favorite === true}
                    disabled={favoritePending.has(model.id)}
                    onClick={async () => {
                      setFavoritePending((current) =>
                        new Set(current).add(model.id),
                      );
                      setFavoriteError(null);
                      setFavoriteOverrides((current) => ({
                        ...current,
                        [model.id]: !model.favorite,
                      }));
                      try {
                        await modelSettingsRequest("models/favorite", "PUT", {
                          provider: model.provider,
                          modelId:
                            model.provider === "openrouter"
                              ? (model.route ??
                                model.id.replace(/^openrouter:/, ""))
                              : model.id,
                          favorite: !model.favorite,
                        });
                        window.dispatchEvent(
                          new Event("model-preferences-changed"),
                        );
                      } catch {
                        setFavoriteOverrides((current) => ({
                          ...current,
                          [model.id]: model.favorite === true,
                        }));
                        setFavoriteError("Couldn't save favorite. Try again.");
                      } finally {
                        setFavoritePending((current) => {
                          const next = new Set(current);
                          next.delete(model.id);
                          return next;
                        });
                      }
                    }}
                  />
                </div>
              ))}
              {models.length === 0 && (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                  {provider?.id === "favorites"
                    ? "Favorite enabled models to find them here."
                    : "No matching models"}
                </p>
              )}
              <button
                type="button"
                className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent-ring"
                onClick={() => {
                  close();
                  void navigate("/settings/openrouter");
                }}
              >
                Choose models
              </button>
            </div>
          </div>
        </div>
      )}
    </AnchoredPopover>
  );
}
