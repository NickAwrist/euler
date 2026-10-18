import { CircleUserRound, ExternalLink, LogOut } from "lucide-react";
import { useState } from "react";
import { whileRunning } from "../../lib/whileRunning";
import {
  disconnectChatGpt,
  finishChatGptLogin,
  startChatGptLogin,
} from "../../persist/chatgpt";
import { Button } from "../Button";
import { ProviderIcon } from "../ModelSelectBar";
import { ServiceIcon } from "../ServiceIcon";
import { providerIcons } from "../modelProviders";
import { inputClass, labelClass } from "./constants";
import type { useChatGptStatus } from "./useChatGptStatus";

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function ChatGptSettingsTab({
  account,
  catalogError,
  onModelsChanged,
}: {
  account: ReturnType<typeof useChatGptStatus>;
  catalogError: string | null;
  onModelsChanged: () => Promise<void>;
}) {
  const { status, loadError, setStatus } = account;
  // The callback URL holds a one-time code, so it only lives in memory.
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const emailShown = hovered || focused;

  const run = (action: () => Promise<void>) =>
    whileRunning(setBusy, async () => {
      setError(null);
      setNotice(null);
      try {
        await action();
      } catch (cause) {
        setError(message(cause));
      }
    });

  const signIn = (newAccount = false) =>
    run(async () => {
      const login = await startChatGptLogin(newAccount);
      setCallbackUrl("");
      setAuthorizationUrl(login.authorizationUrl);
      window.open(login.authorizationUrl, "_blank", "noopener");
    });

  const connect = () =>
    run(async () => {
      setStatus(await finishChatGptLogin(callbackUrl.trim()));
      setCallbackUrl("");
      setAuthorizationUrl(null);
      await onModelsChanged();
    });

  const disconnect = () =>
    run(async () => {
      const { revoked } = await disconnectChatGpt();
      setStatus({
        connected: false,
        email: null,
        name: null,
        picture: null,
        planEnabled: false,
      });
      if (!revoked)
        setNotice(
          "Disconnected here, but ChatGPT didn't confirm. Remove this app's access in ChatGPT Settings.",
        );
      await onModelsChanged();
    });

  const connected = status?.connected === true;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-subtle bg-card px-5 py-4">
        <h2 className="mb-4 flex items-center gap-2 font-medium">
          <ProviderIcon
            provider={{
              id: "chatgpt",
              name: "ChatGPT",
              iconUrl: providerIcons.chatgpt,
              models: [],
            }}
          />
          ChatGPT account
          <span
            className={`ml-auto text-sm ${connected ? "text-emerald-500/90" : "text-muted-foreground"}`}
          >
            {status === null && !loadError
              ? "Loading..."
              : connected
                ? "Connected"
                : "Not connected"}
          </span>
        </h2>

        {connected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ServiceIcon
                icons={status.picture ? [{ src: status.picture }] : []}
                fallback={CircleUserRound}
                size={36}
                className="rounded-full text-muted-foreground"
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">
                  {status.name ?? "ChatGPT account"}
                </p>
                {status.email && (
                  <button
                    type="button"
                    aria-label={emailShown ? undefined : "Show email"}
                    className="-mx-1 block max-w-full truncate rounded px-1 text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-accent-ring"
                    // Touch browsers may not focus buttons on tap.
                    onClick={(event) => event.currentTarget.focus()}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onPointerEnter={(event) =>
                      setHovered(event.pointerType === "mouse")
                    }
                    onPointerLeave={() => setHovered(false)}
                  >
                    <span
                      aria-hidden={!emailShown}
                      className={`transition-[filter] duration-150 motion-reduce:transition-none ${emailShown ? "" : "select-none blur-[5px]"}`}
                    >
                      {status.email}
                    </span>
                  </button>
                )}
              </div>
            </div>
            {!status.planEnabled && (
              <p role="alert" className="text-sm text-red-400">
                This sign-in can't use ChatGPT models. Disconnect and sign in
                again.
              </p>
            )}
            {status.planEnabled && catalogError && (
              <p role="alert" className="text-sm text-red-400">
                Could not load ChatGPT models: {catalogError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <Button
                variant="secondary"
                icon={LogOut}
                loading={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
              <a
                className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-4"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                View usage limits
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}

        {status && !connected && !authorizationUrl && (
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void signIn()}
          >
            Sign in with ChatGPT
          </Button>
        )}

        {status && !connected && authorizationUrl && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:text-muted-foreground">
              <li>
                Sign in on the{" "}
                <a
                  className="inline-flex items-center gap-1 text-accent underline underline-offset-4"
                  href={authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ChatGPT sign-in page
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
                .
              </li>
              <li>
                The page it sends you to won't load. Copy its full address.
              </li>
              <li>Paste the address below.</li>
            </ol>
            <div className="space-y-2">
              <label className={labelClass} htmlFor="chatgpt-callback">
                Callback URL
              </label>
              <input
                id="chatgpt-callback"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                placeholder="http://127.0.0.1:1455/auth/callback?code=..."
                className={inputClass}
              />
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void signIn(true)}
            >
              Use another account
            </Button>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={!callbackUrl.trim()}
                loading={busy}
              >
                Connect
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setCallbackUrl("");
                  setAuthorizationUrl(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
      {(error || loadError) && (
        <p role="alert" className="text-sm text-red-400">
          {error || loadError}
        </p>
      )}
      {notice && (
        <output className="block text-sm text-muted-foreground">
          {notice}
        </output>
      )}
    </div>
  );
}
