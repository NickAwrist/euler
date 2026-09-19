import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { Workspace } from "../workspaces/WorkspaceService";

export type SandboxRunOptions = {
  command: string;
  workspace: Workspace;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  timeoutMs?: number;
};

export type SandboxRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

export interface SandboxRunner {
  capability(): Promise<{ available: boolean; diagnostic?: string }>;
  run(options: SandboxRunOptions): Promise<SandboxRunResult>;
}

const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export class BubblewrapSandboxRunner implements SandboxRunner {
  private capabilityPromise?: Promise<{
    available: boolean;
    diagnostic?: string;
  }>;

  capability(): Promise<{ available: boolean; diagnostic?: string }> {
    this.capabilityPromise ??= this.probe();
    return this.capabilityPromise;
  }

  async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    const capability = await this.capability();
    if (!capability.available) {
      throw new Error(
        capability.diagnostic ||
          "Shell containment is unavailable on this host",
      );
    }
    return this.spawnSandbox(
      this.argumentsFor(options.workspace, options.command),
      options,
    );
  }

  private spawnSandbox(
    args: string[],
    options: SandboxRunOptions,
  ): Promise<SandboxRunResult> {
    return new Promise((resolve, reject) => {
      const executable = this.executable();
      if (!executable) {
        reject(new Error("bubblewrap is not installed"));
        return;
      }
      // A user namespace cannot use container root's DAC override to access
      // another user's private directory. Use the local workspace's owner.
      // Bun does not apply child_process.spawn's uid/gid options.
      const owner =
        process.getuid?.() === 0 && options.workspace.kind === "local"
          ? statSync(options.workspace.hostPath)
          : undefined;
      const child = spawn(
        owner ? "/usr/bin/setpriv" : executable,
        owner
          ? [
              "--reuid",
              String(owner.uid),
              "--regid",
              String(owner.gid),
              "--clear-groups",
              "--",
              executable,
              ...args,
            ]
          : args,
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let truncated = false;
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        callback();
      };
      const stop = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited.
        }
      };
      const append = (current: string, chunk: Buffer): string => {
        const remaining = maxOutput - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          stop();
          return current;
        }
        if (chunk.byteLength > remaining) {
          truncated = true;
          outputBytes += remaining;
          stop();
          return current + chunk.subarray(0, remaining).toString();
        }
        outputBytes += chunk.byteLength;
        return current + chunk.toString();
      };
      const abort = () => {
        stop();
        finish(() => reject(new Error("Command aborted")));
      };
      const timeout = setTimeout(() => {
        stop();
        finish(() => reject(new Error("Command timed out")));
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (exitCode) =>
        finish(() => resolve({ stdout, stderr, exitCode, truncated })),
      );

      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private async probe(): Promise<{ available: boolean; diagnostic?: string }> {
    if (process.platform !== "linux") {
      return {
        available: false,
        diagnostic:
          "Shell tools are disabled because this operating system has no supported containment runner",
      };
    }
    if (!this.executable()) {
      return {
        available: false,
        diagnostic:
          "Shell tools are disabled because bubblewrap is not installed",
      };
    }
    const probeWorkspace: Workspace = {
      kind: "sandbox",
      hostPath: "/tmp",
      displayPath: "/workspace",
    };
    try {
      const result = await this.spawnSandbox(
        this.argumentsFor(probeWorkspace, "true"),
        {
          command: "true",
          workspace: probeWorkspace,
          timeoutMs: 5_000,
          maxOutputBytes: 1_000,
        },
      );
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() || `exited with status ${result.exitCode}`,
        );
      }
      return { available: true };
    } catch (error) {
      return {
        available: false,
        diagnostic: `Shell tools are disabled because bubblewrap cannot create a sandbox: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private argumentsFor(workspace: Workspace, command: string): string[] {
    const args = [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/usr",
      "/usr",
    ];
    if (existsSync("/usr/local"))
      args.push("--ro-bind", "/usr/local", "/usr/local");
    if (existsSync("/etc/alternatives"))
      args.push("--ro-bind", "/etc/alternatives", "/etc/alternatives");
    args.push("--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib");
    if (existsSync("/usr/lib64")) args.push("--symlink", "usr/lib64", "/lib64");
    args.push(
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      workspace.hostPath,
      "/workspace",
      "--chdir",
      "/workspace",
      "--clearenv",
      "--setenv",
      "HOME",
      "/workspace",
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--setenv",
      "PATH",
      "/usr/local/bin:/usr/bin:/bin",
      "--",
      "/bin/sh",
      "-c",
      'ulimit -t 60; ulimit -n 256; ulimit -v 2097152 2>/dev/null || true; exec /bin/sh -c "$1"',
      "euler-shell",
      command,
    );
    return args;
  }

  private executable(): string | null {
    if (existsSync("/usr/bin/bwrap")) return "/usr/bin/bwrap";
    if (existsSync("/bin/bwrap")) return "/bin/bwrap";
    return null;
  }
}

export const sandboxRunner: SandboxRunner = new BubblewrapSandboxRunner();
