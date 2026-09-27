import { afterEach, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import { getFavicon } from "../../src/favicons/faviconService";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

function resolveTo(addresses: Record<string, string>) {
  const lookup = spyOn(dns, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address = addresses[hostname];
    if (!address) throw new Error(`ENOTFOUND ${hostname}`);
    return [{ address, family: address.includes(":") ? 6 : 4 }];
  }) as unknown as typeof dns.lookup);
  restore.push(() => lookup.mockRestore());
}

function respond(...responses: Response[]) {
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected extra request"),
  );
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  restore.push(() => fetch.mockRestore());
  return fetch;
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const image = (contentType = "image/png") =>
  new Response(png, { headers: { "Content-Type": contentType } });

describe("favicon fetching", () => {
  test("never requests hosts that resolve to private addresses", async () => {
    resolveTo({ "intranet.test": "10.0.0.5" });
    const fetch = respond();
    expect(await getFavicon("intranet.test")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("stops redirects that lead to a private address", async () => {
    resolveTo({ "redirect.test": "93.184.216.34" });
    const fetch = respond(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/favicon.ico" },
      }),
      new Response("<html></html>", { status: 404 }),
    );
    expect(await getFavicon("redirect.test")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://redirect.test/favicon.ico",
      "https://redirect.test/",
    ]);
  });

  test("falls back to the icon declared in the page and rejects non-images", async () => {
    resolveTo({
      "site.test": "93.184.216.34",
      "cdn.site.test": "93.184.216.35",
    });
    const fetch = respond(
      new Response("<html>not found</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response(
        '<html><head><link rel="Shortcut Icon" href="//cdn.site.test/icon.png"></head></html>',
        { headers: { "Content-Type": "text/html" } },
      ),
      image(),
    );
    expect(await getFavicon("site.test")).toEqual({
      contentType: "image/png",
      body: png,
    });
    expect(String(fetch.mock.calls[2]?.[0])).toBe(
      "https://cdn.site.test/icon.png",
    );
  });

  test("shares one lookup between concurrent requests for a host", async () => {
    resolveTo({ "shared.test": "93.184.216.34" });
    const fetch = respond(image("image/x-icon"));
    const [first, second] = await Promise.all([
      getFavicon("shared.test"),
      getFavicon("shared.test"),
    ]);
    expect(first?.contentType).toBe("image/x-icon");
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
