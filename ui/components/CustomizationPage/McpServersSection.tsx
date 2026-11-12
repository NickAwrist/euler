import { ExternalLink, LogOut, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { whileRunning } from "../../lib/whileRunning";
import {
  type McpServer,
  type McpServerCheck,
  McpServerOAuth_GrantType,
  checkMcpServerApi,
  disconnectMcpServerOAuthApi,
  finishMcpServerOAuthApi,
  startMcpServerOAuthApi,
} from "../../persist/mcpServers";
import { eyebrowText, inputClass } from "../../styles";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { EnableSwitch } from "../ModelPreferenceControls";
import { RefreshButton } from "../RefreshButton";
import { ServiceIcon } from "../ServiceIcon";
import { TruncateConfirmModal } from "../TruncateConfirmModal";
import { AddMcpServersModal } from "./AddMcpServersModal";
import { useMcpServers } from "./useMcpServers";

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function McpServersSection() {
  const p = useMcpServers();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section aria-labelledby="mcp-servers" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="mcp-servers" className={eyebrowText}>
          MCP servers
        </h2>
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          onClick={() => setAddOpen(true)}
        >
          Add
        </Button>
      </div>
      {p.error && (
        <p role="alert" className="text-[0.75rem] text-red-400">
          {p.error}
        </p>
      )}
      {p.servers.map((server) => (
        <McpServerItem
          key={server.id}
          server={server}
          onServerChange={p.replaceServer}
          onReloadServers={p.load}
          onEnabledChange={(enabled) => void p.setEnabled(server, enabled)}
          onDelete={() => p.setPendingDelete(server)}
        />
      ))}
      {p.servers.length === 0 && (
        <p className="text-[0.8125rem] leading-[1.5] text-muted-foreground">
          No MCP servers yet. Add a remote server to give agents its tools.
        </p>
      )}

      {addOpen && (
        <AddMcpServersModal onAdd={p.add} onClose={() => setAddOpen(false)} />
      )}

      {p.pendingDelete && (
        <TruncateConfirmModal
          title="Remove this MCP server?"
          description={`Remove "${p.pendingDelete.name}" and its saved credentials. Agents will no longer be able to use its tools.`}
          confirmLabel="Remove"
          busyConfirmLabel="Removing..."
          busy={p.deleting}
          onClose={() => p.setPendingDelete(null)}
          onConfirm={() => void p.performDelete()}
        />
      )}
    </section>
  );
}

function McpServerItem({
  server,
  onServerChange,
  onReloadServers,
  onEnabledChange,
  onDelete,
}: {
  server: McpServer;
  onServerChange: (server: McpServer) => void;
  onReloadServers: () => Promise<McpServer[] | null>;
  onEnabledChange: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [check, setCheck] = useState<McpServerCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [pendingOAuth, setPendingOAuth] = useState<{
    authorizationUrl: string;
    redirectUri: string;
  } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    await whileRunning(setChecking, async () => {
      try {
        setCheck(await checkMcpServerApi(server.id));
      } catch (error: unknown) {
        setCheck({
          result: {
            case: "error",
            value: errorText(error, "Check failed"),
          },
          authorizationRequired: false,
        });
      }
    });
  }, [server.id]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  useEffect(() => {
    if (!pendingOAuth) return;

    const syncFromBackend = async () => {
      const updatedList = await onReloadServers();
      const updated = updatedList?.find((item) => item.id === server.id);
      if (updated?.oauth?.connected) {
        setPendingOAuth(null);
        setCallbackUrl("");
        setOauthError(null);
        void runCheck();
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("euler:mcp-oauth");
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!event.data || typeof event.data !== "object") return;
        const data = event.data as {
          type?: unknown;
          serverId?: unknown;
          ok?: unknown;
          error?: unknown;
        };
        if (data.type !== "euler:mcp-oauth" || data.serverId !== server.id) {
          return;
        }
        if (data.ok === true) {
          setPendingOAuth(null);
          setCallbackUrl("");
          setOauthError(null);
          void onReloadServers();
          void runCheck();
        } else {
          setPendingOAuth(null);
          setCallbackUrl("");
          setOauthError(
            typeof data.error === "string" && data.error
              ? data.error
              : "Authorization failed",
          );
        }
      };
    }

    const handleFocus = () => {
      void syncFromBackend();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      channel?.close();
    };
  }, [pendingOAuth, onReloadServers, runCheck, server.id]);

  const startOAuth = () =>
    whileRunning(setOauthBusy, async () => {
      setOauthError(null);
      try {
        const started = await startMcpServerOAuthApi(
          server.id,
          window.location.origin,
        );
        if (started.server) onServerChange(started.server);
        if (!started.authorizationUrl) {
          setPendingOAuth(null);
          setCallbackUrl("");
          await runCheck();
          return;
        }
        setCallbackUrl("");
        setPendingOAuth({
          authorizationUrl: started.authorizationUrl,
          redirectUri: started.redirectUri,
        });
        window.open(started.authorizationUrl, "_blank", "noopener");
      } catch (cause: unknown) {
        setOauthError(errorText(cause, "Failed to start MCP sign-in"));
      }
    });

  const finishOAuth = () =>
    whileRunning(setOauthBusy, async () => {
      setOauthError(null);
      try {
        const updated = await finishMcpServerOAuthApi(
          server.id,
          callbackUrl.trim(),
        );
        onServerChange(updated);
        setPendingOAuth(null);
        setCallbackUrl("");
        await runCheck();
      } catch (cause: unknown) {
        setOauthError(errorText(cause, "Failed to finish MCP sign-in"));
      }
    });

  const disconnectOAuth = () =>
    whileRunning(setOauthBusy, async () => {
      setOauthError(null);
      try {
        const { server: updated } = await disconnectMcpServerOAuthApi(
          server.id,
        );
        onServerChange(updated);
        setPendingOAuth(null);
        setCallbackUrl("");
        await runCheck();
      } catch (cause: unknown) {
        setOauthError(errorText(cause, "Failed to disconnect MCP server"));
      }
    });

  const isClientCredentials =
    server.oauth?.grantType === McpServerOAuth_GrantType.CLIENT_CREDENTIALS;
  const needsAuthorize =
    !isClientCredentials &&
    (check?.authorizationRequired === true ||
      (server.oauth?.configured === true && !server.oauth.connected));
  const showDisconnect =
    !isClientCredentials &&
    server.oauth?.connected === true &&
    check?.authorizationRequired !== true;

  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[160px] flex-1 items-center gap-3">
          <ServiceIcon
            icons={
              check?.result.case === "connected"
                ? check.result.value.icons
                : undefined
            }
            fallback={Plug}
            size={15}
            className="text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-medium text-foreground">
              {server.name}
            </div>
            <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
              {server.url}
              {server.headerNames.length > 0 &&
                ` · headers: ${server.headerNames.join(", ")}`}
              {server.oauth &&
                (isClientCredentials
                  ? " · OAuth client credentials"
                  : showDisconnect
                    ? " · OAuth connected"
                    : " · OAuth")}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {needsAuthorize && !pendingOAuth && (
            <Button
              size="sm"
              variant="primary"
              loading={oauthBusy}
              onClick={() => void startOAuth()}
            >
              Authorize
            </Button>
          )}
          {showDisconnect && !pendingOAuth && (
            <Button
              size="sm"
              variant="secondary"
              icon={LogOut}
              loading={oauthBusy}
              onClick={() => void disconnectOAuth()}
            >
              Disconnect
            </Button>
          )}
          <RefreshButton
            iconOnly
            label={`Refresh ${server.name} tools`}
            refreshing={checking}
            disabled={checking}
            onClick={() => void runCheck()}
          />
          <EnableSwitch
            label={`Enable ${server.name}`}
            checked={server.enabled}
            onChange={onEnabledChange}
          />
          <IconButton
            size="sm"
            variant="danger"
            icon={Trash2}
            label={`Remove ${server.name}`}
            onClick={onDelete}
          />
        </div>
      </div>

      {pendingOAuth && (
        <form
          className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void finishOAuth();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-muted-foreground">
            <a
              className="inline-flex items-center gap-1 text-accent underline underline-offset-4"
              href={pendingOAuth.authorizationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open sign-in page
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label={`Callback URL for ${server.name}`}
              value={callbackUrl}
              onChange={(event) => setCallbackUrl(event.target.value)}
              placeholder={`${pendingOAuth.redirectUri}?code=...`}
              className={`${inputClass} min-w-[220px] flex-1 h-8 text-[0.75rem]`}
            />
            <Button
              size="sm"
              type="submit"
              variant="primary"
              disabled={!callbackUrl.trim()}
              loading={oauthBusy}
            >
              Connect
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={oauthBusy}
              onClick={() => {
                setPendingOAuth(null);
                setCallbackUrl("");
                setOauthError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {oauthError && (
        <p
          role="alert"
          className="mt-2 break-words text-[0.75rem] text-red-400"
        >
          {oauthError}
        </p>
      )}

      <McpToolSummary check={check} />
    </div>
  );
}

function McpToolSummary({ check }: { check: McpServerCheck | null }) {
  if (!check) {
    return (
      <p className="mt-2 text-[0.75rem] text-muted-foreground">
        Loading tools...
      </p>
    );
  }
  if (check.authorizationRequired) {
    return (
      <output className="mt-2 block text-[0.75rem] text-muted-foreground">
        Authorization required.
      </output>
    );
  }
  if (check.result.case !== "connected") {
    return (
      <output className="mt-2 block break-words text-[0.75rem] text-red-400">
        Could not connect: {check.result.value}
      </output>
    );
  }
  if (check.result.value.tools.length === 0) {
    return (
      <output className="mt-2 block text-[0.75rem] text-muted-foreground">
        The server offers no tools.
      </output>
    );
  }
  return (
    <ul aria-label="Tools" className="mt-2.5 flex flex-wrap gap-1.5">
      {check.result.value.tools.map((tool) => (
        <li
          key={tool.name}
          title={tool.description}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-[3px] font-mono text-[0.6875rem] text-foreground"
        >
          <ServiceIcon icons={tool.icons} fallback={Plug} size={12} />
          {tool.name}
        </li>
      ))}
    </ul>
  );
}
