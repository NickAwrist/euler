import { expect, test } from "@playwright/test";

test("markdown rendering preserves lists, lines, code, tables, and link navigation", async ({
  page,
}) => {
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

  const source = reply.getByRole("link", { name: /Lighthouse history/ });
  await expect(source).toHaveText("Lighthouse historyexample.com");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
});
