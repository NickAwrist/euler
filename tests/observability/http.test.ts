import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import express from "express";
import { OperationError } from "../../src/observability/errors";
import {
  errorHandler,
  requestObservability,
  sendError,
} from "../../src/observability/http";
import {
  ERROR_MESSAGES,
  decodeErrorDetails,
} from "../../src/schemas/observability";

/** The diagnostic in a failed response's JSON body. */
const diagnostic = async (response: Response) =>
  decodeErrorDetails(((await response.json()) as { error?: unknown }).error);

let server: Server | undefined;
afterEach(() => server?.close());

function start(): Promise<string> {
  const app = express();
  app.use(requestObservability);
  app.use(express.json({ limit: "1kb" }));
  app.get("/crash", () => {
    throw new Error("secret provider body");
  });
  app.get("/unreachable", () => {
    throw new OperationError("COMFY_UNREACHABLE", {
      message: "connect ECONNREFUSED 10.0.0.2",
    });
  });
  app.post("/validate", (_req, res) =>
    sendError(res, "INVALID_REQUEST", "Choose a model"),
  );
  app.use(errorHandler);
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (address && typeof address === "object")
        resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("HTTP diagnostics", () => {
  test("correlates an unexpected error without exposing its text", async () => {
    const url = await start();
    const response = await fetch(`${url}/crash`, {
      headers: { "X-Request-Id": "untrusted" },
    });
    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();
    expect(requestId).not.toBe("untrusted");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: ERROR_MESSAGES.INTERNAL_ERROR,
        requestId,
      },
    });
  });

  test("keeps a known server failure's shared message", async () => {
    const url = await start();
    const response = await fetch(`${url}/unreachable`);
    expect(response.status).toBe(502);
    expect(await diagnostic(response)).toMatchObject({
      code: "COMFY_UNREACHABLE",
      message: ERROR_MESSAGES.COMFY_UNREACHABLE,
    });
  });

  test("preserves a specific validation message", async () => {
    const url = await start();
    const response = await fetch(`${url}/validate`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(await diagnostic(response)).toMatchObject({
      code: "INVALID_REQUEST",
      message: "Choose a model",
      requestId: expect.any(String),
    });
  });

  test("reports body parser failures as client errors", async () => {
    const url = await start();
    const post = (body: string) =>
      fetch(`${url}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    expect((await diagnostic(await post("{")))?.code).toBe("INVALID_REQUEST");
    const tooLarge = await post(JSON.stringify({ text: "x".repeat(2048) }));
    expect(tooLarge.status).toBe(413);
    expect((await diagnostic(tooLarge))?.code).toBe("BODY_TOO_LARGE");
  });
});
