import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { searchBrave } from "../../src/brave/client";
import { setBraveSearchApiKey } from "../../src/db";

const restore: Array<() => void> = [];
beforeEach(() => setBraveSearchApiKey("brave-test-key"));
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

function respond(...responses: Response[]) {
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected extra search request"),
  );
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  restore.push(() => fetch.mockRestore());
  return fetch;
}

function skipRetryDelay() {
  const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  restore.push(() => sleep.mockRestore());
  return sleep;
}

const results = (...rows: unknown[]) =>
  Response.json({ web: { results: rows } });

describe("Brave Search", () => {
  test("returns readable text and skips malformed results", async () => {
    const fetch = respond(
      results(
        { title: "missing url" },
        {
          title: "<strong>Tokio</strong> &amp; Rust",
          url: "https://tokio.rs",
          description: "An <strong>async</strong> runtime",
        },
        { title: "Docs", url: "https://docs.rs/tokio" },
      ),
    );
    expect(await searchBrave("tokio", 5)).toEqual([
      {
        title: "Tokio & Rust",
        url: "https://tokio.rs",
        content: "An async runtime",
      },
      {
        title: "Docs",
        url: "https://docs.rs/tokio",
        content: "No description available.",
      },
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.search.brave.com/res/v1/web/search?q=tokio&count=5",
    );
    expect(init?.headers).toMatchObject({
      "X-Subscription-Token": "brave-test-key",
    });
  });

  test("treats a response without web results as no matches", async () => {
    respond(Response.json({ type: "search" }));
    expect(await searchBrave("unmatched query", 5)).toEqual([]);
  });

  test("waits out the per-second rate limit before retrying", async () => {
    const sleep = skipRetryDelay();
    const fetch = respond(
      new Response(null, { status: 429 }),
      results({ title: "Tokio", url: "https://tokio.rs" }),
    );
    expect(await searchBrave("tokio", 5)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  test("stops retrying when the rate limit persists", async () => {
    skipRetryDelay();
    const fetch = respond(
      new Response(null, { status: 429 }),
      new Response(null, { status: 429 }),
      new Response(null, { status: 429 }),
    );
    await expect(searchBrave("tokio", 5)).rejects.toThrow(
      "monthly quota may be used up",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("reports Brave's explanation for a rejected key", async () => {
    respond(
      Response.json(
        {
          type: "ErrorResponse",
          error: { detail: "The provided subscription token is invalid." },
        },
        { status: 422 },
      ),
    );
    await expect(searchBrave("tokio", 5)).rejects.toThrow(
      "HTTP 422: The provided subscription token is invalid.",
    );
  });

  test("explains a missing key without calling Brave", async () => {
    setBraveSearchApiKey("");
    const fetch = respond();
    await expect(searchBrave("tokio", 5)).rejects.toThrow(
      "Add one in Settings > Web Search",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
