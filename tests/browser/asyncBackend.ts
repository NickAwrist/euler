import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

/** Starts the shared isolated HTTP backend and owns its temporary data. */
export async function startAsyncBackend({
  port,
  mode = "agents",
  log,
}: {
  port: number;
  mode?: "agents" | "jobs" | "permissions";
  log?: (chunk: Buffer) => void;
}) {
  const server = spawn("bun", ["tests/helpers/asyncFixture.ts"], {
    stdio: "pipe",
    env: {
      ...process.env,
      JOB_FIXTURE_PORT: String(port),
      JOB_FIXTURE: mode === "jobs" ? "1" : "",
      TOOL_PERMISSION_FIXTURE: mode === "permissions" ? "1" : "",
    },
  });
  const exited = new Promise<void>((resolve) => server.once("close", resolve));
  server.stdout.on("data", (chunk: Buffer) => log?.(chunk));
  server.stderr.on("data", (chunk: Buffer) => log?.(chunk));
  const stop = async () => {
    server.kill();
    await exited;
    if (server.pid)
      rmSync(`/tmp/euler-async-browser-${server.pid}`, {
        recursive: true,
        force: true,
      });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => finish(new Error("Fixture failed to start")),
        10000,
      );
      const ready = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("async fixture ready")) finish();
      };
      const failed = (error: Error) => finish(error);
      const closed = (code: number | null) =>
        finish(new Error(`Fixture exited ${code}`));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        server.stdout.off("data", ready);
        server.off("error", failed);
        server.off("close", closed);
        if (error) reject(error);
        else resolve();
      };
      server.stdout.on("data", ready);
      server.once("error", failed);
      server.once("close", closed);
    });
  } catch (error) {
    await stop();
    throw error;
  }
  return { url: `http://127.0.0.1:${port}`, stop };
}
