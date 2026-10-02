import { inputClass, labelClass } from "../../styles";
import { Button } from "../Button";
import type { BraveSettingsState } from "./useBraveSettings";

/** Brave key form; without `actions`, the parent saves the typed key. */
export function BraveSettings({
  brave,
  actions = true,
}: {
  brave: BraveSettingsState;
  actions?: boolean;
}) {
  const { settings, key, busy, error } = brave;
  const locked = !settings || settings.environmentManaged || busy;
  return (
    <section className="space-y-3">
      <h2 className="font-medium">Brave Search</h2>
      <p className="text-xs text-muted-foreground">
        When configured, Brave handles web searches instead of SearXNG.
      </p>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-red-400">
          <p>{error}</p>
          {!settings && (
            <Button variant="secondary" onClick={() => void brave.load()}>
              Retry
            </Button>
          )}
        </div>
      )}
      <label htmlFor="brave-key" className={labelClass}>
        API key{settings?.hasKey ? " · Configured" : ""}
      </label>
      <input
        id="brave-key"
        type="password"
        autoComplete="off"
        className={inputClass}
        value={key}
        onChange={(e) => brave.setKey(e.target.value)}
        disabled={locked}
        placeholder={
          settings?.environmentManaged
            ? "Managed by the environment"
            : settings?.hasKey
              ? "Enter a replacement key"
              : "Enter a Brave Search API key"
        }
      />
      {actions && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={locked || !key.trim()}
            loading={busy}
            onClick={() => void brave.save(key.trim())}
          >
            Save key
          </Button>
          {settings?.hasKey && !settings.environmentManaged && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void brave.save("")}
            >
              Remove key
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
