import { describe, expect, test } from "bun:test";
import { fetchOpenRouterBalance } from "../src/openRouterBalance";

const key = {
  limit: 20,
  limit_remaining: 7.5,
  limit_reset: "monthly",
  usage: 32.5,
};
function requestFor(
  keyBody: unknown,
  creditsBody: unknown,
  creditsStatus = 200,
  keyStatus = 200,
): typeof fetch {
  return Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        "Bearer test-secret",
      );
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return String(input).endsWith("/key")
        ? Response.json(keyBody, { status: keyStatus })
        : Response.json(creditsBody, { status: creditsStatus });
    },
    { preconnect: fetch.preconnect },
  );
}

describe("OpenRouter balance", () => {
  test("separates account credits from a resetting key allowance and all-time usage", async () => {
    const result = await fetchOpenRouterBalance(
      "test-secret",
      requestFor(
        { data: { ...key, label: "secret-label" } },
        { data: { total_credits: 100, total_usage: 81.25 } },
      ),
    );
    expect(result).toEqual({
      accountBalance: 18.75,
      keyLimit: 20,
      keyRemaining: 7.5,
      keyLimitReset: "monthly",
      keyUsage: 32.5,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  test("preserves negative balances", async () => {
    const result = await fetchOpenRouterBalance(
      "test-secret",
      requestFor({ data: key }, { data: { total_credits: 1, total_usage: 2 } }),
    );
    expect(result.accountBalance).toBe(-1);
  });
  test("supports restricted account credits and an uncapped key", async () => {
    const result = await fetchOpenRouterBalance(
      "test-secret",
      requestFor(
        {
          data: {
            ...key,
            limit: null,
            limit_remaining: null,
            limit_reset: null,
          },
        },
        { error: "restricted" },
        403,
      ),
    );
    expect(result.accountBalance).toBeNull();
    expect(result.keyLimit).toBeNull();
    expect(result.keyRemaining).toBeNull();
  });
  test("rejects authentication and provider failures without forwarding provider text", async () => {
    for (const [keyStatus, creditsStatus] of [
      [401, 403],
      [200, 500],
      [200, 401],
    ]) {
      await expect(
        fetchOpenRouterBalance(
          "test-secret",
          requestFor(
            { data: key },
            { error: "test-secret" },
            creditsStatus,
            keyStatus,
          ),
        ),
      ).rejects.toThrow("Could not load OpenRouter balance");
    }
  });
  test("rejects malformed upstream data", async () => {
    await expect(
      fetchOpenRouterBalance(
        "test-secret",
        requestFor(
          { data: { ...key, limit_remaining: "7.5" } },
          { data: { total_credits: 100, total_usage: 10 } },
        ),
      ),
    ).rejects.toThrow();
  });
});
