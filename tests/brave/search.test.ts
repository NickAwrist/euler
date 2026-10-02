import { afterEach, expect, spyOn, test } from "bun:test";
import { searchBrave } from "../../src/brave/search";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Brave sends credentials only in headers and normalizes sources", async () => {
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      web: {
        results: [
          {
            title: "Example",
            url: "https://example.com",
            description: "Description",
          },
          { title: "Other", url: "https://other.test" },
        ],
      },
    }),
  );
  expect(await searchBrave("secret-key", "test query", 1)).toEqual([
    {
      title: "Example",
      url: "https://example.com",
      content: "Description",
      engine: "Brave",
    },
  ]);
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toContain("q=test+query");
  expect(String(url)).not.toContain("secret-key");
  expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe(
    "secret-key",
  );
});

test("Brave rejects malformed results and HTTP failures", async () => {
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ web: { results: [{}] } }))
    .mockResolvedValueOnce(new Response("", { status: 429 }));
  await expect(searchBrave("key", "query", 5)).rejects.toThrow();
  await expect(searchBrave("key", "query", 5)).rejects.toThrow("HTTP 429");
  fetch.mockRestore();
});
