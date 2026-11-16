import { useFeatures } from "../../hooks/useFeatures";
import { type Feature, setFeatureEnabled } from "../../persist/features";
import { eyebrowText } from "../../styles";
import { SwitchField } from "./SwitchField";

/** The features agents may use. One the server cannot run says why and stays off. */
export function Features() {
  const { features, setFeatures, error, setError } = useFeatures();

  const toggle = (feature: Feature, enabled: boolean) => {
    const withEnabled = (value: boolean) => (current: Feature[] | null) =>
      (current ?? []).map((item) =>
        item.id === feature.id ? { ...item, enabled: value } : item,
      );
    setError(null);
    setFeatures(withEnabled(enabled));
    setFeatureEnabled(feature.id, enabled)
      .then(setFeatures)
      .catch((saveError: unknown) => {
        setFeatures(withEnabled(!enabled));
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Failed to save feature",
        );
      });
  };

  return (
    <section aria-labelledby="features" className="flex flex-col gap-3">
      <h2 id="features" className={eyebrowText}>
        Features
      </h2>
      {error && (
        <p role="alert" className="text-[0.75rem] text-red-400">
          {error}
        </p>
      )}
      {(features ?? [])
        .filter((feature) => feature.toggleable)
        .map((feature) => {
          const unavailable = feature.unavailableReason !== undefined;
          return (
            <SwitchField
              key={feature.id}
              id={`feature-${feature.id}`}
              label={feature.label}
              hint={feature.unavailableReason ?? feature.description}
              checked={feature.enabled && !unavailable}
              disabled={unavailable}
              onChange={(enabled) => toggle(feature, enabled)}
            />
          );
        })}
    </section>
  );
}
