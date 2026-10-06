import crypto from "node:crypto";
import { constants, existsSync, mkdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { DATA_ROOT } from "../db/constants";
import type { SessionRow } from "../db/types";
import { OperationError } from "../observability/errors";
import { logEvent } from "../observability/logger";
import type { SessionWorkspace } from "../schemas/sessions";
import { loadWorkspaceIgnore } from "./WorkspaceIgnore";

export type WorkspaceKind = "sandbox" | "local";

export type Workspace = {
  kind: WorkspaceKind;
  hostPath: string;
  displayPath: string;
};

export type WorkspaceFile = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};

const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** A rejected workspace operation whose message is safe to show. */
export class WorkspaceError extends OperationError {
  constructor(message: string) {
    super("INVALID_REQUEST", { message });
    this.name = "WorkspaceError";
  }
}

export class WorkspaceService {
  readonly retainedRoot: string;
  readonly trashRoot: string;

  constructor(readonly dataRoot = DATA_ROOT) {
    this.retainedRoot = join(dataRoot, "workspaces");
    this.trashRoot = join(dataRoot, "workspace-trash");
    mkdirSync(this.retainedRoot, { recursive: true });
    mkdirSync(this.trashRoot, { recursive: true });
  }

  private cleanupTimer?: ReturnType<typeof setInterval>;

  async initialize(): Promise<void> {
    this.cleanupTimer ??= setInterval(() => {
      void this.cleanupExpired().catch((error) =>
        logEvent("error", "workspace.cleanup_failed", {}, error),
      );
    }, 60_000);
    this.cleanupTimer.unref();
    await this.cleanupExpired();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  async cleanupExpired(): Promise<void> {
    await this.purgeExpiredDirectories(this.trashRoot, TRASH_RETENTION_MS);
  }

  private safeSegment(value: string, field: string): string {
    if (!SAFE_SEGMENT.test(value)) {
      throw new WorkspaceError(`Invalid ${field}`);
    }
    return value;
  }

  retainedPath(ownerUuid: string, sessionId: string): string {
    return join(
      this.retainedRoot,
      this.safeSegment(ownerUuid, "workspace owner"),
      this.safeSegment(sessionId, "session id"),
    );
  }

  async provisionRetained(
    ownerUuid: string,
    sessionId: string,
  ): Promise<Workspace> {
    const requestedPath = this.retainedPath(ownerUuid, sessionId);
    await fs.mkdir(requestedPath, { recursive: true });
    const hostPath = await fs.realpath(requestedPath);
    return { kind: "sandbox", hostPath, displayPath: "/workspace" };
  }

  async resolveSession(row: SessionRow): Promise<Workspace> {
    if (row.workspace_kind === "local") {
      if (!row.session_directory?.trim()) {
        throw new WorkspaceError(
          "This chat's local directory is no longer configured",
        );
      }
      const hostPath = await this.canonicalDirectory(row.session_directory);
      return { kind: "local", hostPath, displayPath: "/workspace" };
    }
    return this.provisionRetained(
      row.owner_uuid,
      row.linked_workspace_id ?? row.id,
    );
  }

  /** `linkedSessionId` is another chat using the linked sandbox, if any. */
  presentation(
    row: SessionRow,
    linkedSessionId: string | null = null,
  ): SessionWorkspace {
    if (row.workspace_kind === "local" && row.session_directory?.trim()) {
      return {
        kind: "local",
        path: row.session_directory,
        label: basename(row.session_directory) || row.session_directory,
      };
    }
    if (row.linked_workspace_id) {
      return {
        kind: "sandbox",
        linked: {
          workspaceId: row.linked_workspace_id,
          sessionId: linkedSessionId,
        },
      };
    }
    return { kind: "sandbox" };
  }

  async canonicalDirectory(path: string): Promise<string> {
    const requested = path.trim();
    if (!requested || !isAbsolute(requested)) {
      throw new WorkspaceError("Selected directory must be an absolute path");
    }
    let canonical: string;
    try {
      canonical = await fs.realpath(requested);
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory())
        throw new WorkspaceError("Selected path is not a directory");
      await fs.access(canonical, constants.R_OK | constants.W_OK);
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError(
        "Selected directory does not exist or is not accessible",
      );
    }
    return canonical;
  }

  /** Permanently removes the chat's sandbox, skipping the trash. */
  async deleteRetained(ownerUuid: string, sessionId: string): Promise<void> {
    await fs.rm(this.retainedPath(ownerUuid, sessionId), {
      recursive: true,
      force: true,
    });
  }

  async trashRetained(ownerUuid: string, sessionId: string): Promise<void> {
    const source = this.retainedPath(ownerUuid, sessionId);
    if (!existsSync(source)) return;
    const target = join(
      this.trashRoot,
      `${Date.now()}-${crypto.randomUUID()}-${this.safeSegment(sessionId, "session id")}`,
    );
    await fs.rename(source, target);
  }

  async resolveExistingPath(
    workspace: Workspace,
    requestedPath: string,
  ): Promise<string> {
    const lexical = this.resolveLexical(workspace, requestedPath);
    let canonical: string;
    try {
      canonical = await fs.realpath(lexical);
    } catch {
      throw new WorkspaceError(`Path does not exist: ${requestedPath}`);
    }
    this.assertInside(workspace.hostPath, canonical);
    return canonical;
  }

  async listFiles(workspace: Workspace): Promise<WorkspaceFile[]> {
    const files: WorkspaceFile[] = [];
    await this.walkFiles(workspace, ".", files);
    return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async readFile(workspace: Workspace, path: string): Promise<string> {
    const file = await this.openFile(workspace, path);
    try {
      return await file.readFile("utf8");
    } finally {
      await file.close();
    }
  }

  async writeFile(
    workspace: Workspace,
    path: string,
    content: string,
  ): Promise<void> {
    // Do not truncate until the opened descriptor has been checked as a regular file.
    const file = await this.openFile(
      workspace,
      path,
      constants.O_WRONLY | constants.O_CREAT,
    );
    try {
      await file.truncate(0);
      await file.writeFile(content, "utf8");
    } finally {
      await file.close();
    }
  }

  async deleteFile(workspace: Workspace, path: string): Promise<void> {
    const target = this.resolveLexical(workspace, path);
    if (target === workspace.hostPath)
      throw new WorkspaceError("Cannot delete the workspace root");
    const parent = await this.openPath(
      workspace,
      relative(workspace.hostPath, dirname(target)) || ".",
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      // unlink never follows the final component, even if it becomes a symlink.
      await fs.unlink(`/proc/self/fd/${parent.fd}/${basename(target)}`);
    } finally {
      await parent.close();
    }
  }

  async readDirectory(workspace: Workspace, path: string) {
    const directory = await this.openPath(
      workspace,
      path,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      return await fs.readdir(`/proc/self/fd/${directory.fd}`, {
        withFileTypes: true,
      });
    } finally {
      await directory.close();
    }
  }

  async readVisibleDirectory(workspace: Workspace, path: string) {
    const rules = await loadWorkspaceIgnore(this, workspace, path);
    const entries = await this.readDirectory(workspace, path);
    return entries.filter(
      (entry) => !rules.ignores(entry.name, entry.isDirectory()),
    );
  }

  async statPath(workspace: Workspace, path: string) {
    const handle = await this.openPath(workspace, path, constants.O_RDONLY);
    try {
      return await handle.stat();
    } finally {
      await handle.close();
    }
  }

  async openFile(
    workspace: Workspace,
    path: string,
    flags = constants.O_RDONLY,
  ): Promise<fs.FileHandle> {
    const file = await this.openPath(workspace, path, flags);
    try {
      if (!(await file.stat()).isFile())
        throw new WorkspaceError("Requested path is not a file");
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  // Linux procfs gives openat-like access relative to pinned directory handles.
  // Every untrusted component is opened with NOFOLLOW, including parents.
  private async openPath(
    workspace: Workspace,
    path: string,
    flags: number,
  ): Promise<fs.FileHandle> {
    if (process.platform !== "linux")
      throw new WorkspaceError("Secure workspace file access requires Linux");
    const target = this.resolveLexical(workspace, path);
    const parts = relative(workspace.hostPath, target)
      .split("/")
      .filter(Boolean);
    let directory = await fs.open(
      workspace.hostPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (!parts.length) return directory;
    try {
      for (const part of parts.slice(0, -1)) {
        const childPath = `/proc/self/fd/${directory.fd}/${part}`;
        if (flags & constants.O_CREAT) {
          try {
            await fs.mkdir(childPath);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "EEXIST"
            )
              throw error;
          }
        }
        const next = await fs.open(
          childPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        await directory.close();
        directory = next;
      }
      return await fs.open(
        `/proc/self/fd/${directory.fd}/${parts.at(-1)}`,
        flags | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      // Raw errors expose the internal /proc path instead of the requested one.
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        throw new WorkspaceError(`Path does not exist: ${path}`);
      // NOFOLLOW refuses a link, which could lead outside the workspace.
      if (error instanceof Error && "code" in error && error.code === "ELOOP")
        throw new WorkspaceError("Path escapes the active workspace");
      throw error;
    } finally {
      await directory.close();
    }
  }

  private resolveLexical(workspace: Workspace, requestedPath: string): string {
    const requested = requestedPath.trim();
    if (!requested) throw new WorkspaceError("A path is required");
    if (
      isAbsolute(requested) &&
      requested !== "/workspace" &&
      !requested.startsWith("/workspace/")
    ) {
      throw new WorkspaceError(
        "Absolute tool paths must start with /workspace",
      );
    }
    const target = resolve(
      workspace.hostPath,
      isAbsolute(requested)
        ? requested.slice("/workspace".length + 1)
        : requested,
    );
    this.assertInside(workspace.hostPath, target);
    return target;
  }

  private assertInside(root: string, target: string): void {
    const rel = relative(resolve(root), resolve(target));
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      throw new WorkspaceError("Path escapes the active workspace");
    }
  }

  private async walkFiles(
    workspace: Workspace,
    directory: string,
    output: WorkspaceFile[],
  ): Promise<void> {
    for (const entry of await this.readVisibleDirectory(workspace, directory)) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await this.walkFiles(workspace, fullPath, output);
      } else if (entry.isFile()) {
        const stat = await this.statPath(workspace, fullPath);
        output.push({
          path: fullPath.split("\\").join("/"),
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      }
    }
  }

  private async purgeExpiredDirectories(
    root: string,
    ttlMs: number,
  ): Promise<void> {
    const now = Date.now();
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name);
      try {
        const stat = statSync(path);
        if (now - stat.mtimeMs > ttlMs) {
          await fs.rm(path, { recursive: true, force: true });
        }
      } catch {
        // Best-effort retention cleanup must not block startup.
      }
    }
  }
}

export const workspaceService = new WorkspaceService();
