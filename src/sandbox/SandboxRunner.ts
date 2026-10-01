import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { errorMessage } from "../utils/errors";
import type { Workspace } from "../workspaces/WorkspaceService";

export type SandboxRunOptions = {
  command: string;
  workspace: Workspace;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  timeoutMs?: number;
  background?: boolean;
  emitOutput?: (chunk: { channel: "stdout" | "stderr"; text: string }) => void;
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
  spawn(options: SandboxRunOptions): Promise<SandboxExecution>;
}

export interface SandboxExecution {
  completion: Promise<SandboxRunResult>;
  cancel(): Promise<void>;
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
    return (await this.spawn(options)).completion;
  }

  async spawn(options: SandboxRunOptions): Promise<SandboxExecution> {
    const capability = await this.capability();
    if (!capability.available) {
      throw new Error(
        capability.diagnostic ||
          "Shell containment is unavailable on this host",
      );
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const completion = this.spawnSandbox(
      this.argumentsFor(options.workspace, options.command, options.background),
      { ...options, signal: controller.signal },
    ).finally(() => options.signal?.removeEventListener("abort", abort));
    // The caller receives the handle asynchronously. Observe immediate failures.
    void completion.catch(() => {});
    return {
      completion,
      cancel: async () => {
        controller.abort();
        await completion.catch(() => {});
      },
    };
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
      let stoppedError: Error | undefined;
      const abort = () => {
        stoppedError = new Error("Command aborted");
        stop();
      };
      const timeout = options.background
        ? undefined
        : setTimeout(() => {
            stop();
            stoppedError = new Error("Command timed out");
          }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        options.emitOutput?.({ channel: "stdout", text: chunk.toString() });
        stdout = options.background
          ? (stdout + chunk.toString()).slice(-65536)
          : append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        options.emitOutput?.({ channel: "stderr", text: chunk.toString() });
        stderr = options.background
          ? (stderr + chunk.toString()).slice(-65536)
          : append(stderr, chunk);
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (exitCode) =>
        finish(() =>
          stoppedError
            ? reject(stoppedError)
            : resolve({ stdout, stderr, exitCode, truncated }),
        ),
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
        diagnostic: `Shell tools are disabled because bubblewrap cannot create a sandbox: ${errorMessage(error)}`,
      };
    }
  }

  private argumentsFor(
    workspace: Workspace,
    command: string,
    background = false,
  ): string[] {
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
      `${background ? "" : "ulimit -t 60; "}ulimit -n 256; ulimit -v 2097152 2>/dev/null || true; exec /bin/sh -c "$1"`,
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
