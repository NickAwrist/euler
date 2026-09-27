import { ProviderIcon } from "./ModelSelectBar";
import { modelProviderId, providerIcons } from "./modelProviders";

export function ModelLabel({
  model,
  className = "inline-flex min-w-0 items-center gap-2",
}: {
  model: string;
  className?: string;
}) {
  const provider = modelProviderId(model);
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
      <span className="truncate">{model.replace(/^openrouter:/, "")}</span>
    </span>
  );
}
