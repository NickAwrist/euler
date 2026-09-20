import { type Page, expect, test } from "@playwright/test";

async function mockApp(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === "/api/sessions"
        ? {
            sessions: [
              {
                id: "sidebar-test",
                preview: "Sidebar test chat",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }
        : path === "/api/sessions/sidebar-test"
          ? {
              id: "sidebar-test",
              model: "test",
              workspace: { kind: "sandbox" },
              history: [
                { role: "user", content: "Check the sidebar controls." },
              ],
            }
          : path === "/api/models"
            ? {
                defaultModel: "test",
                models: [
                  {
                    id: "test",
                    name: "Test",
                    lab: "Test",
                    provider: "ollama",
                    inputCapabilities: ["text"],
                  },
                ],
              }
            : path.endsWith("/health")
              ? { connected: true }
              : path === "/api/agents"
                ? { agents: [] }
                : path.startsWith("/api/runs/active/")
                  ? { active: false }
                  : path.endsWith("/artifacts/tree")
                    ? { entries: [] }
                    : {};
    await route.fulfill({ json });
  });
}

for (const width of [390, 1024, 1440]) {
  const device = width <= 900 ? "mobile" : "desktop";
  test(`chat sidebar ${device} ${width} stationary toggle and chevron`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.goto("/");
    const toggle = page.getByRole("button", {
      name: "Toggle chats",
      exact: true,
    });
    const panel = page.locator("#app-sidebar");
    await expect(toggle).toBeVisible();
    await expect(
      page.locator('button[aria-controls="app-sidebar"]'),
    ).toHaveCount(1);
    const position = (await toggle.boundingBox())!;
    if (width > 900) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle.locator("svg")).toHaveClass(/lucide-panel-left$/);
    await expect(panel).toHaveAttribute("inert", "");
    // Let the initial desktop close complete before measuring the open transition.
    await expect
      .poll(async () => Math.round((await panel.boundingBox())!.x))
      .toBeLessThan(0);
    await page.waitForTimeout(350);
    for (const open of [true, false]) {
      const frames = await page.evaluate(async () => {
        const panel = document.getElementById("app-sidebar")!;
        const toggle = document.querySelector<HTMLButtonElement>(
          'button[aria-controls="app-sidebar"]',
        )!;
        const frames: { panelX: number; toggleX: number }[] = [];
        const sample = () =>
          frames.push({
            panelX: panel.getBoundingClientRect().x,
            toggleX: toggle.getBoundingClientRect().x,
          });
        sample();
        toggle.click();
        const start = performance.now();
        while (performance.now() - start < 380) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          sample();
        }
        return frames;
      });
      expect(
        frames.every((frame) => Math.abs(frame.toggleX - position.x) < 1),
      ).toBe(true);
      const start = frames[0]!.panelX;
      const end = frames.at(-1)!.panelX;
      expect(Math.abs(start - end)).toBeGreaterThan(200);
      expect(
        frames.filter(
          (frame) =>
            frame.panelX > Math.min(start, end) + 5 &&
            frame.panelX < Math.max(start, end) - 5,
        ).length,
      ).toBeGreaterThan(2);
      await expect(toggle).toHaveAttribute("aria-expanded", String(open));
      await expect(toggle.locator("svg")).toHaveClass(
        open ? /lucide-panel-left-close/ : /lucide-panel-left$/,
      );
    }
    // The keyboard shortcut and button must reflect the same state.
    await page.keyboard.press("Control+b");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page
      .locator("#app-sidebar")
      .getByRole("button", { name: /Sidebar test chat/ })
      .click();
    await expect(
      page.getByText("Check the sidebar controls.", { exact: true }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", String(width > 900));
    const right = page.getByRole("button", {
      name: "Toggle artifacts",
      exact: true,
    });
    await expect(right.locator("svg")).toHaveClass(/lucide-panel-right$/);
    await right.click();
    await expect(right.locator("svg")).toHaveClass(/lucide-panel-right-close/);
    await expect(right).toHaveAttribute("aria-expanded", "true");
    if (width <= 900) await expect(toggle).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath("sidebar-controls.png"),
    });
    await right.click();
    await expect(toggle).toBeVisible();
    // Crossing the drawer breakpoint updates the single toggle's state.
    await page.setViewportSize({
      width: width <= 900 ? 1440 : 390,
      height: 900,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", String(width <= 900));
  });
}

test("chat sidebar desktop workspace changes reset artifacts without remounting the chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  let local = false;
  let previews = 0;
  await page.route("**/api/sessions/sidebar-test", (route) =>
    route.fulfill({
      json: {
        id: "sidebar-test",
        model: "test",
        workspace: { kind: "sandbox" },
        history: [
          {
            role: "assistant",
            content:
              "Open [notes](docs/notes.md). These are code: `foo.bar`, `v1.2`, `a/b`.",
          },
        ],
      },
    }),
  );
  await page.route("**/api/directories?*", (route) =>
    route.fulfill({
      json: {
        path: "/demo/local",
        exact: true,
        parent: null,
        directories: [],
      },
    }),
  );
  await page.route("**/workspace/select-directory", (route) => {
    local = true;
    return route.fulfill({
      json: {
        workspace: { kind: "local", path: "/demo/local", label: "local" },
      },
    });
  });
  await page.route("**/artifacts/tree?*", (route) =>
    route.fulfill({
      json: {
        entries:
          new URL(route.request().url()).searchParams.get("path") === "."
            ? [{ name: "docs", path: "docs", kind: "directory" }]
            : [{ name: "notes.md", path: "docs/notes.md", kind: "file" }],
      },
    }),
  );
  await page.route("**/artifacts/preview?*", (route) => {
    previews++;
    return route.fulfill({
      json: {
        kind: "text",
        path: "docs/notes.md",
        content: local ? "# Local notes" : "# Sandbox notes",
      },
    });
  });
  await page.goto("/run/sidebar-test");
  for (const code of ["foo.bar", "v1.2", "a/b"]) {
    await expect(page.locator("code").filter({ hasText: code })).toBeVisible();
    await expect(
      page.getByRole("button", { name: code, exact: true }),
    ).toHaveCount(0);
  }
  const composer = page.getByPlaceholder("Send a message...");
  const originalComposer = await composer.elementHandle();
  const toggle = page.getByRole("button", { name: "Toggle artifacts" });
  await toggle.click();
  const prefetched = page.waitForResponse("**/artifacts/preview?*");
  await page.getByRole("button", { name: "docs", exact: true }).click();
  await (await prefetched).finished();
  // Observe the rendered result, including a loading placeholder too brief for a locator assertion.
  await page.evaluate(() => {
    const panel = document.getElementById("artifact-sidebar")!;
    new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes].some((node) =>
            node.textContent?.includes("Loading preview"),
          ),
        )
      )
        panel.dataset.sawLoading = "true";
    }).observe(panel, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "notes.md", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sandbox notes" }),
  ).toBeVisible();
  await expect(page.locator("#artifact-sidebar")).not.toHaveAttribute(
    "data-saw-loading",
    "true",
  );
  expect(previews).toBe(1);
  await composer.fill("/directory");
  await composer.press("Enter");
  await page.getByRole("textbox", { name: "Folder path" }).fill("/demo/local");
  await page.getByRole("button", { name: "Confirm directory" }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose working directory" }),
  ).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    await originalComposer!.evaluate((element) => element.isConnected),
  ).toBe(true);
  await toggle.click();
  await expect(page.getByRole("button", { name: "Back to files" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "docs", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "docs", exact: true }).click();
  await page.getByRole("button", { name: "notes.md", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Local notes" }),
  ).toBeVisible();
  expect(previews).toBe(2);
});
