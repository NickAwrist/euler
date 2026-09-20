import { expect, test } from "bun:test";
import { readApiError } from "../../ui/lib/readApiError";

test("readApiError extracts string errors", async () => {
  const res = new Response(JSON.stringify({ error: "Something went wrong" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  expect(await readApiError(res)).toBe("Something went wrong");
});

test("readApiError extracts specific error message", async () => {
  const res = new Response(
    JSON.stringify({
      error: {
        code: "CONFLICT",
        message: "A skill with that name already exists",
      },
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(res)).toBe("A skill with that name already exists");
});

test("readApiError extracts first validation issue from fieldErrors when message is generic", async () => {
  const res = new Response(
    JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: {
          formErrors: [],
          fieldErrors: {
            name: [
              "name must use lowercase letters, numbers, and single hyphens only",
            ],
          },
        },
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(res)).toBe(
    "name must use lowercase letters, numbers, and single hyphens only",
  );
});

test("readApiError extracts first validation issue from formErrors when message is generic", async () => {
  const res = new Response(
    JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: {
          formErrors: ["At least one selection required"],
          fieldErrors: {},
        },
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(res)).toBe("At least one selection required");
});

test("readApiError extracts first validation issue when generic message has punctuation or casing variations", async () => {
  const res = new Response(
    JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body.",
        details: {
          fieldErrors: {
            name: ["", "name is required"],
          },
        },
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(res)).toBe("name is required");
});

test("readApiError extracts first issue from raw issues or array details", async () => {
  const resIssues = new Response(
    JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: {
          issues: [{ message: "First raw issue" }],
        },
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(resIssues)).toBe("First raw issue");

  const resArray = new Response(
    JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: [{ message: "First array object issue" }],
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  expect(await readApiError(resArray)).toBe("First array object issue");
});

test("readApiError falls back when response body is not JSON or has no error", async () => {
  const res = new Response("Bad gateway", {
    status: 502,
    statusText: "Bad Gateway",
  });
  expect(await readApiError(res, "Fallback error")).toBe("Fallback error");

  const res2 = new Response("Bad gateway", {
    status: 502,
    statusText: "Bad Gateway",
  });
  expect(await readApiError(res2)).toBe("Bad Gateway");
});
