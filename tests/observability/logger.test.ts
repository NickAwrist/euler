import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { OperationError } from "../../src/observability/errors";
import {
  logEvent,
  serializeError,
  withBackgroundLogContext,
  withLogContext,
} from "../../src/observability/logger";

afterEach(() => {
  process.env.LOG_LEVEL = "silent";
});

describe("serializeError", () => {
  test("retains causal call sites without recording messages", () => {
    const cause = new Error("Bearer secret and user prompt");
    const diagnostic = serializeError(
      new Error("upstream echoed prompt", { cause }),
    );
    expect(diagnostic?.cause?.stack).toContain("logger.test.ts");
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    expect(JSON.stringify(diagnostic)).not.toContain("prompt");
  });

  test("keeps the operation summary and a known native reason", () => {
    const cause = Object.assign(new Error("/private/path"), {
      code: "ENOSPC",
    });
    const diagnostic = serializeError(
      new OperationError("JOB_FAILED", { cause }),
    );
    expect(diagnostic?.cause).toMatchObject({
      code: "ENOSPC",
      message: "No space left on device.",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("/private/path");
  });

  test("bounds cyclic causes", () => {
    const error = new Error("cycle");
    error.cause = error;
    expect(() => JSON.stringify(serializeError(error))).not.toThrow();
  });
});

test("background work does not inherit the request that scheduled it", () => {
  process.env.LOG_LEVEL = "info";
  const lines = spyOn(console, "log").mockImplementation(() => {});
  try {
    withLogContext({ requestId: "req-1" }, () =>
      withBackgroundLogContext({ jobId: "job-1" }, () =>
        logEvent("info", "job.started", { tool: "bash" }),
      ),
    );
    expect(JSON.parse(String(lines.mock.calls[0]?.[0]))).toMatchObject({
      level: "info",
      event: "job.started",
      jobId: "job-1",
      tool: "bash",
    });
    expect(String(lines.mock.calls[0]?.[0])).not.toContain("req-1");
  } finally {
    lines.mockRestore();
  }
});

test("records a surfaced failure reason, bounded", () => {
  process.env.LOG_LEVEL = "warn";
  const lines = spyOn(console, "warn").mockImplementation(() => {});
  try {
    logEvent("warn", "activation.finished", {
      outcome: "error",
      reason: `Insufficient credits ${"x".repeat(2000)}`,
    });
    const record = JSON.parse(String(lines.mock.calls[0]?.[0]));
    expect(record.reason).toStartWith("Insufficient credits");
    expect(record.reason).toHaveLength(1000);
  } finally {
    lines.mockRestore();
  }
});
