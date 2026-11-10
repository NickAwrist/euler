import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import type { DescService } from "@bufbuild/protobuf";
import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { Page } from "@playwright/test";
import { ModelService } from "../../src/gen/euler/v1/models_pb";
import { openRouterModel } from "./appFixture";
import { mockRpc, on } from "./rpcMock";

/** The fixture backend's scripted model. */
export const FIXTURE_MODEL = "openrouter:openai/gpt-5.6-terra";

/**
 * Sends the page's API calls to `backend`. Only the model catalog is mocked,
 * so the fixture model is offered without a provider key.
 */
export async function useBackend(page: Page, backend: string) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${backend}${url.pathname}${url.search}` });
  });
  await mockRpc(page, [
    on(ModelService.method.listModels, () => ({
      models: [
        openRouterModel("openai/gpt-5.6-terra", {
          name: "Fixture",
          lab: "Test",
        }),
      ],
    })),
  ]);
}

/** A client that calls `backend` as `user`, for checking server state. */
export function backendClient<T extends DescService>(
  backend: string,
  service: T,
  user: string,
): Client<T> {
  return createClient(
    service,
    createConnectTransport({
      baseUrl: `${backend}/api/rpc`,
      httpVersion: "1.1",
      interceptors: [
        (next) => (request) => {
          request.header.set("x-euler-user-id", user);
          return next(request);
        },
      ],
    }),
  );
}

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
