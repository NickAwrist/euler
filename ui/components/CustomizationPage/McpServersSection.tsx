import { Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type McpServerCheck,
  type McpServerData,
  checkMcpServerApi,
} from "../../persist/mcpServers";
import { eyebrowText } from "../../styles";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { EnableSwitch } from "../ModelPreferenceControls";
import { RefreshButton } from "../RefreshButton";
import { TruncateConfirmModal } from "../TruncateConfirmModal";
import { AddMcpServersModal } from "./AddMcpServersModal";
import { useMcpServers } from "./useMcpServers";

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
          description={`Remove "${p.pendingDelete.name}" and its saved headers. Agents will no longer be able to use its tools.`}
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
  onEnabledChange,
  onDelete,
}: {
  server: McpServerData;
  onEnabledChange: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [check, setCheck] = useState<McpServerCheck | null>(null);
  const [checking, setChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      setCheck(await checkMcpServerApi(server.id));
    } catch (error: unknown) {
      setCheck({
        ok: false,
        error: error instanceof Error ? error.message : "Check failed",
      });
    } finally {
      setChecking(false);
    }
  }, [server.id]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3">
      <div className="flex items-center gap-3">
        <Plug size={15} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8125rem] font-medium text-foreground">
            {server.name}
          </div>
          <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
            {server.url}
            {server.headerNames.length > 0 &&
              ` · headers: ${server.headerNames.join(", ")}`}
          </div>
        </div>
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
  if (!check.ok) {
    return (
      <output className="mt-2 block break-words text-[0.75rem] text-red-400">
        Could not connect: {check.error}
      </output>
    );
  }
  if (check.tools.length === 0) {
    return (
      <output className="mt-2 block text-[0.75rem] text-muted-foreground">
        The server offers no tools.
      </output>
    );
  }
  return (
    <ul aria-label="Tools" className="mt-2.5 flex flex-wrap gap-1.5">
      {check.tools.map((tool) => (
        <li
          key={tool.name}
          title={tool.description}
          className="rounded-md bg-muted px-2 py-[3px] font-mono text-[0.6875rem] text-foreground"
        >
          {tool.name}
        </li>
      ))}
    </ul>
  );
}
