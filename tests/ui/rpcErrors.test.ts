import { expect, test } from "bun:test";
import { Code } from "@connectrpc/connect";
import { ApiError } from "../../ui/lib/apiError";
import { withErrorMessage } from "../../ui/lib/rpc";

test("unexplained RPC failures report the caller's message", async () => {
  const failure = withErrorMessage(
    Promise.reject(new ApiError("HTTP 503", 0, undefined, Code.Unavailable)),
    "Failed to load tools",
  );
  const error = await failure.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).message).toBe("Failed to load tools");
  expect((error as ApiError).code).toBe(Code.Unavailable);
});

test("server-explained RPC failures keep the server's message", async () => {
  const explained = new ApiError("Skill name is taken", 0, {
    code: "CONFLICT",
    message: "Skill name is taken",
  });
  const failure = withErrorMessage(
    Promise.reject(explained),
    "Failed to create skill",
  );
  expect(await failure.catch((caught: unknown) => caught)).toBe(explained);
});

test("cancelled calls pass through unchanged", async () => {
  const aborted = new DOMException("Aborted", "AbortError");
  const failure = withErrorMessage(Promise.reject(aborted), "Failed");
  expect(await failure.catch((caught: unknown) => caught)).toBe(aborted);
});
