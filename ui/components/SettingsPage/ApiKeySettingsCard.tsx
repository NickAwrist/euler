import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "../Button";
import { EnvironmentSettingHint } from "./EnvironmentSettingHint";
import { inputClass, labelClass } from "./constants";
import type { ApiKeySetting } from "./useApiKeySetting";

type Props = {
  setting: ApiKeySetting;
  title: string;
  inputId: string;
  placeholder: string;
  onSaved?: () => Promise<void>;
};

export function ApiKeySettingsCard({
  setting,
  title,
  inputId,
  placeholder,
  onSaved,
}: Props) {
  const { environmentManaged, hasKey, loading, loadError } = setting;
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const environmentId = `${inputId}-environment`;

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await setting.save(value);
      setApiKey("");
      setEditing(false);
      await onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="rounded-xl border border-border-subtle bg-card px-5 py-4">
        <h2 className="mb-4 flex items-center gap-2 font-medium">
          <KeyRound size={18} /> {title}{" "}
          <span
            className={`ml-auto text-sm ${!loading && hasKey ? "text-emerald-500/90" : "text-muted-foreground"}`}
          >
            {loading ? "Loading..." : hasKey ? "Configured" : "Not configured"}
          </span>
        </h2>
        {!loading && hasKey && !editing && !environmentManaged && (
          <Button
            variant="secondary"
            disabled={environmentManaged !== false}
            onClick={() => setEditing(true)}
          >
            Update key
          </Button>
        )}
        {!loading && (!hasKey || editing || environmentManaged) && (
          <>
            <label className={labelClass} htmlFor={inputId}>
              API key
            </label>
            <input
              id={inputId}
              aria-describedby={environmentManaged ? environmentId : undefined}
              type="password"
              autoComplete="off"
              value={environmentManaged ? "••••••••" : apiKey}
              disabled={environmentManaged !== false}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "Enter a replacement key" : placeholder}
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
                  onClick={() => void save(apiKey)}
                >
                  Save key
                </Button>
                {hasKey && (
                  <Button
                    variant="secondary"
                    disabled={environmentManaged !== false || busy}
                    onClick={() => void save("")}
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
                      setEditing(false);
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
          <EnvironmentSettingHint id={environmentId} managed />
        )}
      </section>
      {(error || loadError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || loadError}
        </p>
      )}
    </>
  );
}
