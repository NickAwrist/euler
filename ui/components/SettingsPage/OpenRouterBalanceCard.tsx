import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { OpenRouterBalance } from "../../../src/schemas/openRouterBalance";
import { loadOpenRouterBalance } from "../../persist/openRouter";
import { RefreshButton } from "../RefreshButton";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function OpenRouterBalanceCard() {
  const [balance, setBalance] = useState<OpenRouterBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setBalance(null);
    void loadOpenRouterBalance(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setBalance(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <section
      className="space-y-4 rounded-xl border border-border-subtle bg-card px-5 py-4"
      aria-label="OpenRouter credits"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Credits and usage</h2>
        <RefreshButton
          label="Refresh balance"
          refreshing={loading}
          onClick={() => setRevision((value) => value + 1)}
        />
      </div>
      {loading && (
        <output className="text-sm text-muted-foreground">
          Loading balance...
        </output>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load OpenRouter balance. Try refreshing.
        </p>
      )}
      {balance && (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Account balance</dt>
              <dd className="text-lg font-medium tabular-nums">
                {balance.accountBalance === null
                  ? "Unavailable for this key"
                  : dollars.format(balance.accountBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                Key allowance remaining
              </dt>
              <dd className="text-lg font-medium tabular-nums">
                {balance.keyLimit === null
                  ? "No spending limit"
                  : balance.keyRemaining === null
                    ? "Unavailable"
                    : dollars.format(balance.keyRemaining)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                Key usage, all time
              </dt>
              <dd className="text-lg font-medium tabular-nums">
                {dollars.format(balance.keyUsage)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            {balance.accountBalance === null &&
              "OpenRouter requires a management key to read the account balance. "}
            {balance.keyLimit !== null &&
              `Key spending limit: ${dollars.format(balance.keyLimit)}${balance.keyLimitReset ? `, resets ${balance.keyLimitReset}` : ""}. `}
            Key allowance is separate from account credits.
          </p>
        </>
      )}
      <a
        className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-4"
        href="https://openrouter.ai/settings/credits"
        target="_blank"
        rel="noreferrer"
      >
        View credits on OpenRouter
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
