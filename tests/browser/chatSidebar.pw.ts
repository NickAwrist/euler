import { type Page, expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});

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
                expiresAt: null,
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
              : path.endsWith("/runtime")
                ? {
                    agents: [],
                    activation: null,
                    queued: [],
                    held: false,
                    sequence: 0,
                    history: [
                      { role: "user", content: "Check the sidebar controls." },
                    ],
                  }
                : path.endsWith("/artifacts/tree")
                  ? { entries: [] }
                  : path === "/api/settings/environment"
                    ? { ollamaHost: false, comfyuiHost: false }
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
    await mockUserPreferences(page);
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

test("chat sidebar desktop workspace changes refresh open artifacts without remounting the chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  let local = false;
  let previews = 0;
  await page.route(/\/api\/sessions\/sidebar-test(?:\/runtime)?$/, (route) =>
    route.fulfill({
      json: {
        id: "sidebar-test",
        agents: [],
        activation: null,
        queued: [],
        held: false,
        sequence: 0,
        model: "test",
        workspace: { kind: "sandbox" },
        history: [
          {
            role: "assistant",
            content:
              "Open [notes](docs/notes.md). These are code: `foo.bar`, `v1.2`, `a/b`.",
            attachments: [
              {
                id: "30a14710-74b8-4aa0-aa40-90e9b5ac606e",
                kind: "file",
                name: "fib.py",
                path: "fib.py",
                size: 10,
                sessionId: "sidebar-test",
                workspaceKind: "sandbox",
              },
            ],
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
        directories: [
          { name: ".cache", path: "/demo/local/.cache" },
          { name: "src", path: "/demo/local/src" },
        ],
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
  await mockUserPreferences(page);
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
  const fileChip = page.getByRole("button", { name: "Preview fib.py" });
  await expect(fileChip).toBeEnabled();
  await composer.fill("/directory");
  await composer.press("Enter");
  const directoryDialog = page.getByRole("dialog", {
    name: "Choose working directory",
  });
  await expect(directoryDialog.getByText("src", { exact: true })).toBeVisible();
  await expect(directoryDialog.getByText(".cache")).toHaveCount(0);
  await directoryDialog.getByLabel("Show hidden folders").check();
  await expect(directoryDialog.getByText(".cache")).toBeVisible();
  await page.getByRole("textbox", { name: "Folder path" }).fill("/demo/local");
  await page.getByRole("button", { name: "Use this folder" }).click();
  await expect(directoryDialog).toBeHidden();
  await expect(fileChip).toBeDisabled();
  await expect(
    page.getByText(
      "Created in this chat's private workspace. Run /sandbox to view.",
    ),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    await originalComposer!.evaluate((element) => element.isConnected),
  ).toBe(true);
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

test("chat sidebar desktop preserves collapsed state on reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/");
  const toggle = page.getByRole("button", {
    name: "Toggle chats",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("chat sidebar desktop restores artifact preview and width on reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await page.route("**/artifacts/tree?*", (route) =>
    route.fulfill({
      json: {
        entries: [{ name: "notes.md", path: "notes.md", kind: "file" }],
      },
    }),
  );
  await page.route("**/artifacts/preview?*", (route) =>
    route.fulfill({
      json: {
        kind: "text",
        path: "notes.md",
        content: "# Saved preview",
      },
    }),
  );
  await mockUserPreferences(page);
  await page.goto("/run/sidebar-test");
  const toggle = page.getByRole("button", { name: "Toggle artifacts" });
  await toggle.click();
  await page.getByRole("button", { name: "notes.md", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved preview" }),
  ).toBeVisible();
  const resize = page.getByRole("separator", {
    name: "Resize artifact sidebar",
  });
  await resize.press("ArrowLeft");
  const width = await resize.getAttribute("aria-valuenow");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("heading", { name: "Saved preview" }),
  ).toBeVisible();
  await expect(resize).toHaveAttribute("aria-valuenow", width!);
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("chat sidebar desktop rename starts empty and ignores unchanged saves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push(request.url());
  });
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByLabel("Display name");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", "Sidebar test chat");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(patches).toEqual([]);
});

test("chat sidebar desktop export and opt-in debug access", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Chat options" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Rename",
    "Export",
    "Delete",
  ]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sidebar-test-chat.md");
  const stream = await download.createReadStream();
  let transcript = "";
  for await (const chunk of stream) transcript += chunk.toString();
  expect(transcript).toMatch(
    /^# Sidebar test chat\n\n- Exported: .+\n- Model: test\n\nUSER\n===\nCheck the sidebar controls\.$/,
  );
  expect(new URL(page.url()).pathname).toBe("/");
  await page
    .locator("#app-sidebar")
    .getByRole("button", { name: /Sidebar test chat/ })
    .click();
  await expect(page.locator("main .workspace-header")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Debug inspector", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("chat-without-header.png"),
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const developerTools = page
    .locator("details")
    .filter({ hasText: "Developer tools" });
  await expect(developerTools).not.toHaveAttribute("open", "");
  await developerTools.locator("summary").click();
  const showDebug = page.getByRole("switch", {
    name: /Display debug button/,
  });
  await expect(showDebug).not.toBeChecked();
  await showDebug.check();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Debug inspector", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Debug", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close debug inspector", exact: true })
    .click();
  const chatsToggle = page.getByRole("button", {
    name: "Toggle chats",
    exact: true,
  });
  if ((await chatsToggle.getAttribute("aria-expanded")) === "false")
    await chatsToggle.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("details summary").click();
  await showDebug.uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByRole("button", { name: "Debug inspector", exact: true }),
  ).toHaveCount(0);
});

test("chat sidebar desktop keeps a remembered files panel closed for an empty workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "euler:artifactSidebarState",
      JSON.stringify({ open: true, workspace: "", path: null }),
    ),
  );
  const tree = page.waitForResponse("**/artifacts/tree?*");
  await mockUserPreferences(page);
  await page.goto("/run/sidebar-test");
  await tree;
  await expect(page).toHaveTitle("Sidebar test chat · Euler");
  const toggle = page.getByRole("button", { name: "Toggle artifacts" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("No files in this folder.")).toBeVisible();
  // Escape belongs to whatever has focus; only the panel's own Escape closes it.
  await page.getByPlaceholder("Send a message...").press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Refresh files" }).press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("chat sidebar desktop jumps to the latest message after scrolling up", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await mockApp(page);
  await page.route(/\/api\/sessions\/sidebar-test(?:\/runtime)?$/, (route) =>
    route.fulfill({
      json: {
        id: "sidebar-test",
        agents: [],
        activation: null,
        queued: [],
        held: false,
        sequence: 0,
        model: "test",
        workspace: { kind: "sandbox" },
        history: Array.from({ length: 40 }, (_, i) => ({
          role: i % 2 ? "assistant" : "user",
          content: `Message ${i}`,
        })),
      },
    }),
  );
  await mockUserPreferences(page);
  await page.goto("/run/sidebar-test");
  const latest = page.getByText("Message 39", { exact: true });
  const jump = page.getByRole("button", { name: "Jump to latest" });
  await expect(latest).toBeInViewport();
  await expect(jump).toHaveCount(0);
  await page.mouse.move(720, 300);
  await page.mouse.wheel(0, -3000);
  await expect(jump).toBeVisible();
  await expect(latest).not.toBeInViewport();
  await jump.click();
  await expect(latest).toBeInViewport();
  await expect(jump).toHaveCount(0);
});

async function openLayoutChat(
  page: Page,
  width: number,
  appearance: Record<string, unknown>,
) {
  await page.setViewportSize({ width, height: 900 });
  await mockApp(page);
  await page.addInitScript((appearance) => {
    localStorage.setItem(
      "euler:appearance",
      JSON.stringify({ sidebarAnimationMs: 0, ...appearance }),
    );
    localStorage.setItem("euler:artifactSidebarWidth", "560");
  }, appearance);
  await page.route("**/artifacts/tree?*", (route) =>
    route.fulfill({
      json: {
        entries: [{ name: "notes.md", path: "notes.md", kind: "file" }],
      },
    }),
  );
  await mockUserPreferences(page);
  await page.goto("/run/sidebar-test");
  await expect(page.getByText("Check the sidebar controls.")).toBeVisible();
  const chats = page.getByRole("button", { name: "Toggle chats", exact: true });
  const composer = page.locator(".pointer-events-auto.relative");
  return {
    setChats: async (open: boolean) => {
      if ((await chats.getAttribute("aria-expanded")) !== String(open))
        await chats.click();
    },
    toggleArtifacts: () =>
      page.getByRole("button", { name: "Toggle artifacts" }).click(),
    composerSpan: async () => {
      const box = (await composer.boundingBox())!;
      return [Math.round(box.x), Math.round(box.x + box.width)];
    },
  };
}

test("chat sidebar desktop panels slide over empty space and nudge the chat only as needed", async ({
  page,
}) => {
  const layout = await openLayoutChat(page, 1440, {});
  await layout.setChats(false);
  // A 768px column centered in 1440px.
  await expect.poll(layout.composerSpan).toEqual([336, 1104]);
  await layout.setChats(true);
  await expect.poll(layout.composerSpan).toEqual([336, 1104]);
  await expect(page.locator("main")).toHaveCSS("margin-left", "0px");
  await layout.setChats(false);
  // The 560px panel starts at 880px; the column moves just clear of it.
  await layout.toggleArtifacts();
  await expect.poll(layout.composerSpan).toEqual([92, 860]);
  // With both panels open the column narrows to the space between them.
  await layout.setChats(true);
  await expect.poll(layout.composerSpan).toEqual([280, 860]);
});

test("chat sidebar desktop panels set to make room always move the chat", async ({
  page,
}) => {
  const layout = await openLayoutChat(page, 1440, {
    shiftForChatList: true,
    shiftForArtifacts: true,
  });
  await layout.setChats(true);
  await expect(page.locator("main")).toHaveCSS("margin-left", "260px");
  await expect(page.locator("#app-sidebar")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await layout.toggleArtifacts();
  await expect(page.locator("main")).toHaveCSS("margin-right", "560px");
});

test("chat sidebar mobile chat uses the full width with any setting", async ({
  page,
}) => {
  const layout = await openLayoutChat(page, 390, {
    chatWidth: "full",
    shiftForChatList: true,
  });
  await expect.poll(layout.composerSpan).toEqual([14, 376]);
  await layout.setChats(true);
  await expect(page.locator("main")).toHaveCSS("margin-left", "0px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("chat sidebar desktop: narrow windows do not overwrite the shared artifact width", async ({
  page,
}) => {
  const store = new Map<
    string,
    import("../../src/schemas/userPreferences").UserPreferences
  >();
  const user = "11111111-1111-4111-8111-111111111111";
  await page.addInitScript((user) => {
    localStorage.setItem("euler:userUuid", user);
    localStorage.setItem("euler:artifactSidebarWidth", "800");
  }, user);
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockApp(page);
  await mockUserPreferences(page, store);
  await page.goto("/run/sidebar-test");
  await expect(
    page.getByRole("button", { name: "Toggle artifacts" }),
  ).toBeVisible();
  await expect.poll(() => store.get(user)?.layout.artifactWidth).toBe(800);
  await expect(page.locator("#artifact-sidebar")).toHaveCSS("width", "400px");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(page.locator("#artifact-sidebar")).toHaveCSS("width", "800px");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator("#artifact-sidebar")).toHaveCSS("width", "400px");
  await page
    .getByRole("separator", { name: "Resize artifact sidebar" })
    .click();
  expect(store.get(user)?.layout.artifactWidth).toBe(800);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator("#artifact-sidebar")).toHaveCSS("width", "800px");
  await page.reload();
  await expect(page.locator("#artifact-sidebar")).toHaveCSS("width", "800px");
});
