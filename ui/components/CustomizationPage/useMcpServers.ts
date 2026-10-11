import { useCallback, useEffect, useState } from "react";
import {
  type McpServerData,
  addMcpServersApi,
  deleteMcpServerApi,
  fetchMcpServers,
  setMcpServerEnabledApi,
} from "../../persist/mcpServers";

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<McpServerData | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setServers(await fetchMcpServers());
    } catch (loadError: unknown) {
      setError(message(loadError, "Failed to load MCP servers"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Throws so the add form can show the reason next to the pasted config. */
  const add = async (config: unknown) => {
    const added = await addMcpServersApi(config);
    setServers((current) => [...current, ...added]);
  };

  const setEnabled = async (server: McpServerData, enabled: boolean) => {
    setError(null);
    try {
      const updated = await setMcpServerEnabledApi(server.id, enabled);
      setServers((current) =>
        current.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch (updateError: unknown) {
      setError(message(updateError, "Failed to update MCP server"));
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMcpServerApi(pendingDelete.id);
      setServers((current) => current.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (deleteError: unknown) {
      setError(message(deleteError, "Failed to delete MCP server"));
    } finally {
      setDeleting(false);
    }
  };

  return {
    servers,
    error,
    add,
    setEnabled,
    pendingDelete,
    setPendingDelete,
    deleting,
    performDelete,
  };
}
