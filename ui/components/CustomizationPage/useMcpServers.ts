import { useCallback, useEffect, useState } from "react";
import { whileRunning } from "../../lib/whileRunning";
import {
  type McpServer,
  addMcpServersApi,
  deleteMcpServerApi,
  fetchMcpServers,
  setMcpServerEnabledApi,
} from "../../persist/mcpServers";

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchMcpServers();
      setServers(next);
      return next;
    } catch (loadError: unknown) {
      setError(message(loadError, "Failed to load MCP servers"));
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceServer = useCallback((updated: McpServer) => {
    setServers((current) =>
      current.map((s) => (s.id === updated.id ? updated : s)),
    );
  }, []);

  /** Throws so the add form can show the reason next to the pasted config. */
  const add = async (config: string) => {
    const added = await addMcpServersApi(config);
    setServers((current) => [...current, ...added]);
  };

  const setEnabled = async (server: McpServer, enabled: boolean) => {
    setError(null);
    try {
      const updated = await setMcpServerEnabledApi(server.id, enabled);
      replaceServer(updated);
    } catch (updateError: unknown) {
      setError(message(updateError, "Failed to update MCP server"));
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    await whileRunning(setDeleting, async () => {
      setError(null);
      try {
        await deleteMcpServerApi(pendingDelete.id);
        setServers((current) =>
          current.filter((s) => s.id !== pendingDelete.id),
        );
        setPendingDelete(null);
      } catch (deleteError: unknown) {
        setError(message(deleteError, "Failed to delete MCP server"));
      }
    });
  };

  return {
    servers,
    error,
    load,
    replaceServer,
    add,
    setEnabled,
    pendingDelete,
    setPendingDelete,
    deleting,
    performDelete,
  };
}
