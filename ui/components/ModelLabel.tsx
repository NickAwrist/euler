import { ProviderIcon } from "./ModelSelectBar";
import { modelProviderId, providerIcons } from "./modelProviders";

export function ModelLabel({
  model,
  className = "inline-flex min-w-0 items-center gap-2",
  hideProvider = false,
}: {
  model: string;
  className?: string;
  /** Drop the OpenRouter publisher prefix, leaving the icon to show it. */
  hideProvider?: boolean;
}) {
  const provider = modelProviderId(model);
  const route = model.replace(/^openrouter:/, "");
  const name =
    hideProvider && route !== model
      ? route.slice(route.indexOf("/") + 1)
      : route;
  return (
    <span className={className} title={model}>
      <ProviderIcon
        provider={{
          id: provider,
          name: provider,
          iconUrl:
            provider === "ollama"
              ? "/icons/ollama.svg"
              : providerIcons[provider],
          models: [],
        }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
