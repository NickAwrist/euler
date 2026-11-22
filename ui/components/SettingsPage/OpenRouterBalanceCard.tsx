import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { ModelProvider } from "../../../src/gen/euler/v1/models_pb";
import type { GetProviderBalanceResponse as ProviderBalance } from "../../../src/gen/euler/v1/providers_pb";
import { loadProviderBalance } from "../../persist/openRouter";
import { RefreshButton } from "../RefreshButton";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type BalanceProviderMeta = {
  label: string;
  creditsUrl: string;
  creditsLinkLabel: string;
  hasKeyAllowance: boolean;
};

const META: Record<
  ModelProvider.OPENROUTER | ModelProvider.VERCEL_GATEWAY,
  BalanceProviderMeta
> = {
  [ModelProvider.OPENROUTER]: {
    label: "OpenRouter",
    creditsUrl: "https://openrouter.ai/settings/credits",
    creditsLinkLabel: "View credits on OpenRouter",
    hasKeyAllowance: true,
  },
  [ModelProvider.VERCEL_GATEWAY]: {
    label: "Vercel AI Gateway",
    creditsUrl: "https://vercel.com/ai-gateway",
    creditsLinkLabel: "View credits on Vercel",
    hasKeyAllowance: false,
  },
};

export function ProviderBalanceCard({
  provider = ModelProvider.OPENROUTER,
}: {
  provider?: ModelProvider.OPENROUTER | ModelProvider.VERCEL_GATEWAY;
}) {
  const meta = META[provider];
  const [balance, setBalance] = useState<ProviderBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setBalance(null);
    void loadProviderBalance(provider, controller.signal)
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
  }, [provider, revision]);
  return (
    <section
      className="space-y-4 rounded-xl border border-border-subtle bg-card px-5 py-4"
      aria-label={`${meta.label} credits`}
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
          Could not load {meta.label} balance. Try refreshing.
        </p>
      )}
      {balance && (
        <>
          <dl
            className={
              meta.hasKeyAllowance
                ? "grid gap-4 sm:grid-cols-3"
                : "grid gap-4 sm:grid-cols-2"
            }
          >
            <div>
              <dt className="text-sm text-muted-foreground">Account balance</dt>
              <dd className="text-lg font-medium tabular-nums">
                {balance.accountBalance === undefined
                  ? "Unavailable for this key"
                  : dollars.format(balance.accountBalance)}
              </dd>
            </div>
            {meta.hasKeyAllowance && (
              <div>
                <dt className="text-sm text-muted-foreground">
                  Key allowance remaining
                </dt>
                <dd className="text-lg font-medium tabular-nums">
                  {balance.keyLimit === undefined
                    ? "No spending limit"
                    : balance.keyRemaining === undefined
                      ? "Unavailable"
                      : dollars.format(balance.keyRemaining)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-muted-foreground">
                {meta.hasKeyAllowance
                  ? "Key usage, all time"
                  : "Total usage, all time"}
              </dt>
              <dd className="text-lg font-medium tabular-nums">
                {dollars.format(balance.keyUsage)}
              </dd>
            </div>
          </dl>
          {meta.hasKeyAllowance && (
            <p className="text-sm text-muted-foreground">
              {balance.accountBalance === undefined &&
                "OpenRouter requires a management key to read the account balance. "}
              {balance.keyLimit !== undefined &&
                `Key spending limit: ${dollars.format(balance.keyLimit)}${balance.keyLimitReset ? `, resets ${balance.keyLimitReset}` : ""}. `}
              Key allowance is separate from account credits.
            </p>
          )}
        </>
      )}
      <a
        className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-4"
        href={meta.creditsUrl}
        target="_blank"
        rel="noreferrer"
      >
        {meta.creditsLinkLabel}
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </section>
  );
}

export function OpenRouterBalanceCard() {
  return <ProviderBalanceCard provider={ModelProvider.OPENROUTER} />;
}
