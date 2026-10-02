import { expect, test } from "@playwright/test";

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("attachment image loading defers until after initial scroll and reuses cached previews", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/attachments/*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto("/dev/images");
  await expect(page.getByAltText("Image 19", { exact: true })).toBeVisible();
  expect(requests.length).toBeLessThan(6);
  expect(requests.every((url) => Number(url.split("-").at(-1)) >= 17)).toBe(
    true,
  );
  const image = page.getByAltText("Image 19", { exact: true });
  const bounds = await image.boundingBox();
  expect(bounds?.height).toBe(190);
  const count = requests.length;
  await page.getByRole("button", { name: "Toggle images" }).click();
  await page.getByRole("button", { name: "Toggle images" }).click();
  await expect(image).toBeVisible();
  expect(requests).toHaveLength(count);
  await page.getByTestId("image-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByAltText("Image 0", { exact: true })).toBeVisible();
});

test("attachment image loading retries failures without resizing the preview", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/attachments/*", async (route) => {
    await route.fulfill(
      fail
        ? { status: 500, json: { error: "Unavailable" } }
        : { contentType: "image/png", body: png },
    );
  });
  await page.goto("/dev/images");
  const error = page.getByText("Failed to load Image 19", { exact: true });
  await expect(error).toBeVisible();
  const before = await error.locator("../..").boundingBox();
  fail = false;
  await error.locator("..").getByRole("button", { name: "Retry" }).click();
  const image = page.getByAltText("Image 19", { exact: true });
  await expect(image).toBeVisible();
  const after = await image.locator("../..").boundingBox();
  expect(after).toEqual(before);
});

test("attachment image loading aborts transfers when previews unmount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const target: {
      fetch: (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Promise<Response>;
    } = window;
    const originalFetch = target.fetch;
    target.fetch = (input, init) => {
      if (!String(input).startsWith("/api/attachments/"))
        return originalFetch(input, init);
      const root = document.documentElement;
      root.dataset.downloads = String(Number(root.dataset.downloads ?? 0) + 1);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            root.dataset.aborts = String(Number(root.dataset.aborts ?? 0) + 1);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    };
  });
  await page.goto("/dev/images");
  await expect(page.locator("html")).toHaveAttribute("data-downloads", "2");
  await page.getByRole("button", { name: "Toggle images" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-aborts", "2");
  expect(errors).toEqual([]);
});
