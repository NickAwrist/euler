import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
  type RunPermissions,
  permissionService,
} from "../permissions/PermissionService";
import { errorMessage } from "../utils/errors";
import type { Workspace } from "../workspaces/WorkspaceService";
import { type ExecutionUser, discoverToolchains } from "./toolchains";

export type SandboxRunOptions = {
  command: string;
  workspace: Workspace;
  permissions: RunPermissions;
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
    const permissions = options.permissions;
    permissionService.assertTool(permissions, "bash");
    const capability = await this.capability();
    if (!capability.available) {
      throw new Error(
        capability.diagnostic ||
          "Shell containment is unavailable on this host",
      );
    }
    // A user namespace cannot use root's DAC override for a private directory.
    // Resolve the execution identity once for discovery and the actual launch.
    const owner =
      process.getuid?.() === 0 && options.workspace.kind === "local"
        ? statSync(options.workspace.hostPath)
        : undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const completion = this.spawnSandbox(
      this.argumentsFor(
        options.workspace,
        options.command,
        permissions,
        options.background,
        owner,
      ),
      { ...options, permissions, signal: controller.signal },
      owner,
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
    owner?: ExecutionUser,
  ): Promise<SandboxRunResult> {
    return new Promise((resolve, reject) => {
      const executable = this.executable();
      if (!executable) {
        reject(new Error("bubblewrap is not installed"));
        return;
      }
      // Bun does not apply child_process.spawn's uid/gid options.
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
          }, options.timeoutMs ??
            options.permissions.shell.foregroundTimeoutMs);

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
    const permissions = permissionService.resolve(probeWorkspace);
    try {
      const result = await this.spawnSandbox(
        this.argumentsFor(probeWorkspace, "true", permissions),
        {
          command: "true",
          workspace: probeWorkspace,
          permissions,
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
    permissions: RunPermissions,
    background = false,
    owner?: ExecutionUser,
  ): string[] {
    const args = [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/usr",
      "/usr",
    ];
    if (permissions.shell.network === "host") {
      args.push("--share-net");
      // DNS and TLS configuration are required by package downloads.
      for (const path of [
        "/etc/resolv.conf",
        "/etc/hosts",
        "/etc/nsswitch.conf",
        "/etc/ssl/certs",
        "/etc/ssl/openssl.cnf",
        "/etc/ca-certificates/extracted",
        "/etc/pki/tls/certs",
        "/etc/pki/tls/openssl.cnf",
        "/etc/pki/ca-trust/extracted",
      ]) {
        if (existsSync(path)) args.push("--ro-bind", path, path);
      }
    }
    if (existsSync("/usr/local"))
      args.push("--ro-bind", "/usr/local", "/usr/local");
    if (existsSync("/etc/alternatives"))
      args.push("--ro-bind", "/etc/alternatives", "/etc/alternatives");
    args.push("--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib");
    if (existsSync("/usr/lib64")) args.push("--symlink", "usr/lib64", "/lib64");
    let path = "/usr/local/bin:/usr/bin:/bin";
    if (permissions.shell.hostToolchains) {
      for (const tool of discoverToolchains(owner)) {
        args.push("--ro-bind", tool.path, `/opt/euler/bin/${tool.name}`);
        if (tool.name === "bun")
          args.push("--symlink", "bun", "/opt/euler/bin/bunx");
      }
      path = `/opt/euler/bin:${path}`;
    }
    const limits = [
      ...(background
        ? []
        : [`ulimit -t ${permissions.shell.foregroundCpuSeconds}`]),
      `ulimit -n ${permissions.shell.openFiles}`,
      ...(permissions.shell.virtualMemoryKb === null
        ? []
        : [
            `ulimit -v ${permissions.shell.virtualMemoryKb} 2>/dev/null || true`,
          ]),
    ];
    args.push(
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      ...(permissions.shell.hostToolchains ? ["--dir", "/tmp/home"] : []),
      "--bind",
      workspace.hostPath,
      "/workspace",
      "--chdir",
      "/workspace",
      "--clearenv",
      "--setenv",
      "HOME",
      permissions.shell.hostToolchains ? "/tmp/home" : "/workspace",
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--setenv",
      "PATH",
      path,
      "--",
      "/bin/sh",
      "-c",
      `${limits.join("; ")}; exec /bin/sh -c "$1"`,
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
