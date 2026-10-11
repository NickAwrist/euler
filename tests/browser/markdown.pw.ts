import { expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

test("markdown rendering previews image links including extensionless URLs", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://images.example.com/**", (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith("/docs"))
      return route.fulfill({ contentType: "text/html", body: "Documentation" });
    if (url.endsWith("/broken.png"))
      return route.fulfill({ status: 404, body: "Missing" });
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
  await mockUserPreferences(page);
  await page.goto("/dev/messages?image-links");
  const reply = page.getByRole("region", { name: "Message 1", exact: true });
  const previews = reply.getByAltText("Linked image", { exact: true });
  await expect(previews.filter({ visible: true })).toHaveCount(2);
  await expect(reply.getByAltText("Embedded", { exact: true })).toBeVisible();
  await expect(
    reply.getByRole("link", { name: "Documentation", exact: true }),
  ).toBeVisible();
  await expect(reply.getByText("Failed to load image")).toHaveCount(0);
  await expect(
    reply.getByRole("link", { name: "Open image in new tab" }),
  ).toHaveCount(2);
  expect(requests.filter((url) => url.includes("first.png"))).toHaveLength(1);
  expect(requests.some((url) => url.includes("code.png"))).toBe(false);
  const link = reply
    .getByRole("link", { name: "Open image in new tab" })
    .nth(1);
  await expect(link).toHaveAttribute(
    "href",
    "https://images.example.com/render?id=2",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("markdown rendering preserves lists, lines, code, tables, and link navigation", async ({
  page,
}) => {
  await mockUserPreferences(page);
  await page.goto("/dev/messages?markdown");
  const reply = page.getByRole("region", { name: "Message 1", exact: true });
  await expect(reply.locator("ol")).toHaveCSS("list-style-type", "decimal");
  await expect(reply.locator("ol")).toHaveAttribute("start", "3");
  await expect(reply.locator("ul")).toHaveCount(2);
  for (const list of await reply.locator("ul").all()) {
    await expect(list).toHaveCSS("list-style-type", "disc");
  }
  await expect(reply.locator("ol ul li")).toHaveText("Nested bullet");
  const poem = reply.locator("p").filter({ hasText: "Local weights awaken," });
  await expect(poem.locator("br")).toHaveCount(2);
  await expect(reply.locator("pre")).toHaveText(
    "Unlabeled code\nwith two lines",
  );
  await expect(reply.locator("pre br")).toHaveCount(0);
  await expect(reply.getByRole("cell", { name: "42" })).toBeVisible();
  const math = reply.locator("p").filter({ hasText: "The ball costs" });
  await expect(math).toContainText("The ball costs $0.05, so");
  await expect(math.locator(".katex")).toHaveCount(1);
  await expect(math.locator("annotation")).toHaveText("2x + 1.00 = 1.10");
  await expect(reply.locator(".katex-display annotation")).toHaveText(
    "\\frac{a}{b}",
  );

  for (const name of ["External docs", "Protocol relative"]) {
    const link = reply.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  for (const name of ["Jump", "Email"]) {
    await expect(
      reply.getByRole("link", { name, exact: true }),
    ).not.toHaveAttribute("target");
  }
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({
      body: "External documentation",
      contentType: "text/html",
    }),
  );
  const popupPromise = page.waitForEvent("popup");
  await reply.getByRole("link", { name: "External docs", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://example.com/docs");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(page).toHaveURL(/\/dev\/messages\?markdown$/);
  await popup.close();

  await mockUserPreferences(page);
  await page.goto("/dev/artifacts");
  await page.getByRole("button", { name: "the notes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace notes" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dev\/artifacts$/);
});

test("markdown rendering shows tool output images once and opens sources in a new tab", async ({
  page,
}) => {
  await page.route("**/api/comfyui/view/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await mockUserPreferences(page);
  await page.goto("/dev/messages?markdown");
  const reply = page.getByRole("region", { name: "Message 2", exact: true });
  await expect(reply.getByRole("img")).toHaveCount(2);
  await expect(reply.getByAltText("Lighthouse", { exact: true })).toBeVisible();
  await expect(
    reply.getByAltText("Generated image", { exact: true }),
  ).toHaveAttribute("src", "/api/comfyui/view/omitted.png?type=output");
  await expect(
    reply.getByRole("link", { name: /^Open generated image \d in new tab$/ }),
  ).toHaveCount(2);

  const toggle = reply.getByRole("button", { name: "1 source" });
  const source = reply.getByRole("link", { name: /Lighthouse history/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(source).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(source).toHaveText("Lighthouse historyexample.com");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
});
