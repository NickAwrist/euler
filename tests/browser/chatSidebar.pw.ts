import type { MessageInitShape } from "@bufbuild/protobuf";
import { type Page, expect, test } from "@playwright/test";
import { WorkspaceFileAttachment_WorkspaceKind } from "../../src/gen/euler/v1/attachments_pb";
import { DirectoryService } from "../../src/gen/euler/v1/directories_pb";
import {
  Appearance_ChatWidth,
  type UpdatePreferencesRequest_AppearancePatchSchema,
} from "../../src/gen/euler/v1/preferences_pb";
import { SessionService } from "../../src/gen/euler/v1/sessions_pb";
import {
  ArtifactEntry_Kind,
  WorkspaceService,
} from "../../src/gen/euler/v1/workspace_pb";
import { userPreferencesSchema } from "../../src/schemas/userPreferences";
import {
  type MessageInit,
  at,
  message,
  mockApp as mockChatApp,
} from "./appFixture";
import { mockRpc, on, rpcKey } from "./rpcMock";
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

const chat = (
  history: MessageInit[] = [message("user", "Check the sidebar controls.")],
) => ({
  "sidebar-test": { model: "test", history },
});

async function mockApp(page: Page, history?: MessageInit[]) {
  await mockChatApp(page, {
    sessions: [
      { id: "sidebar-test", preview: "Sidebar test chat", updatedAt: at(1) },
    ],
    chats: chat(history),
  });
}

/** Serves one artifact folder level per path. */
function artifacts(
  entries: (
    path: string,
  ) => { name: string; path: string; directory?: boolean }[],
) {
  return on(WorkspaceService.method.listArtifacts, ({ path }) => ({
    entries: entries(path).map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry.directory
        ? ArtifactEntry_Kind.DIRECTORY
        : ArtifactEntry_Kind.FILE,
    })),
  }));
}

/** A text preview for any path. */
function preview(content: (path: string) => string) {
  return on(WorkspaceService.method.previewArtifact, ({ path }) => ({
    preview: { path, content: { case: "text" as const, value: content(path) } },
  }));
}

for (const width of [320, 390, 1024, 1440]) {
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
    // Contents fill the responsive drawer, with only the intended edge padding.
    const layout = await panel.evaluate((panel) => {
      const content = panel.firstElementChild as HTMLElement;
      const row = content.querySelector("section button")!.parentElement!;
      const padding = Number.parseFloat(getComputedStyle(content).paddingRight);
      return {
        panelWidth: panel.clientWidth,
        contentWidth: content.getBoundingClientRect().width,
        rowRight: row.getBoundingClientRect().right,
        contentRight: content.getBoundingClientRect().right - padding,
      };
    });
    expect(layout.contentWidth).toBeCloseTo(layout.panelWidth, 0);
    expect(layout.rowRight).toBeCloseTo(layout.contentRight, 0);
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

for (const width of [320, 390]) {
  test(`chat sidebar mobile ${width} contains scrolling at drawer boundaries`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 664 });
    await mockApp(page);
    await mockRpc(page, [
      on(SessionService.method.listSessions, () => ({
        sessions: Array.from({ length: 40 }, (_, i) => ({
          id: `scroll-${i}`,
          preview: `Conversation ${i + 1}`,
          updatedAt: at(Date.now() - i * 1000),
        })),
      })),
    ]);
    await mockUserPreferences(page);
    await page.goto("/");
    const toggle = page.getByRole("button", {
      name: "Toggle chats",
      exact: true,
    });
    await toggle.click();
    const panel = page.locator("#app-sidebar");
    await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0);
    const position = (await toggle.boundingBox())!;
    const list = panel.locator(".overflow-y-auto");
    await expect(list).toBeVisible();
    // Chromium cannot render iOS's elastic bounce. Check the declarations
    // Safari needs as well as actual scrolling and stationary controls.
    for (const root of [page.locator("html"), page.locator("body")]) {
      await expect(root).toHaveCSS("overscroll-behavior-y", "none");
      await expect(root).toHaveCSS("overflow-y", "hidden");
    }
    await expect(list).toHaveCSS("overscroll-behavior-y", "contain");
    const bounds = (await list.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    for (const delta of [3000, 200, -3000, -200]) {
      await page.mouse.wheel(0, delta);
      await expect
        .poll(() => list.evaluate((el) => el.scrollTop))
        .toBe(
          delta > 0
            ? await list.evaluate((el) => el.scrollHeight - el.clientHeight)
            : 0,
        );
      expect(await toggle.boundingBox()).toEqual(position);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    // Scrolling outside the drawer must not move its toggle either.
    await page.mouse.move(width - 5, 300);
    await page.mouse.wheel(0, -200);
    expect(await toggle.boundingBox()).toEqual(position);
    await page.setViewportSize({ width, height: 550 });
    await expect(panel).toHaveCSS("height", "550px");
    expect((await toggle.boundingBox())!.y).toBe(position.y);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      panel.getByRole("button", { name: "Settings", exact: true }),
    ).toBeInViewport();
  });
}

test("chat sidebar desktop workspace changes refresh open artifacts without remounting the chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page, [
    message(
      "assistant",
      "Open [notes](docs/notes.md). These are code: `foo.bar`, `v1.2`, `a/b`.",
      {
        attachments: [
          {
            kind: {
              case: "file",
              value: {
                id: "30a14710-74b8-4aa0-aa40-90e9b5ac606e",
                name: "fib.py",
                path: "fib.py",
                size: 10n,
                sessionId: "sidebar-test",
                workspaceKind: WorkspaceFileAttachment_WorkspaceKind.SANDBOX,
              },
            },
          },
        ],
      },
    ),
  ]);
  let local = false;
  let previews = 0;
  await mockRpc(page, [
    on(DirectoryService.method.listDirectory, () => ({
      path: "/demo/local",
      exact: true,
      directories: [
        { name: ".cache", path: "/demo/local/.cache" },
        { name: "src", path: "/demo/local/src" },
      ],
    })),
    on(WorkspaceService.method.selectDirectory, () => {
      local = true;
      return {
        workspace: {
          kind: {
            case: "local" as const,
            value: { path: "/demo/local", label: "local" },
          },
        },
      };
    }),
    artifacts((path) =>
      path === "."
        ? [{ name: "docs", path: "docs", directory: true }]
        : [{ name: "notes.md", path: "docs/notes.md" }],
    ),
    on(WorkspaceService.method.previewArtifact, () => {
      previews++;
      return {
        preview: {
          path: "docs/notes.md",
          content: {
            case: "text" as const,
            value: local ? "# Local notes" : "# Sandbox notes",
          },
        },
      };
    }),
  ]);
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
  const prefetched = page.waitForResponse(
    (response) =>
      rpcKey(response.request()) === "WorkspaceService/PreviewArtifact",
  );
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

test("chat sidebar desktop links another chat's workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApp(page);
  const linkRequests: unknown[] = [];
  await mockRpc(page, [
    on(SessionService.method.listSessions, () => ({
      sessions: [
        { id: "sidebar-test", preview: "Sidebar test chat", updatedAt: at(2) },
        { id: "builder", preview: "Builder chat", updatedAt: at(1) },
      ],
    })),
    on(WorkspaceService.method.linkWorkspace, ({ sourceSessionId }) => {
      linkRequests.push({ sourceSessionId });
      return {
        workspace: {
          kind: {
            case: "sandbox" as const,
            value: { linked: { workspaceId: "builder", sessionId: "builder" } },
          },
        },
      };
    }),
  ]);
  await mockUserPreferences(page);
  await page.goto("/run/sidebar-test");
  const composer = page.getByPlaceholder("Send a message...");
  await composer.fill("/li");
  await expect(
    page.getByRole("button", { name: /Return this chat/ }),
  ).toHaveCount(0);
  await composer.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Link a chat's workspace",
  });
  await expect(dialog.getByText("Sidebar test chat")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Builder chat" }).click();
  await expect(dialog).toBeHidden();
  expect(linkRequests).toEqual([{ sourceSessionId: "builder" }]);
  await expect(
    page.getByText("Linked to Builder chat's workspace"),
  ).toBeVisible();
  await composer.fill("/");
  await expect(
    page.getByRole("button", { name: /Return this chat/ }),
  ).toBeVisible();
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
  await mockRpc(page, [
    artifacts(() => [{ name: "notes.md", path: "notes.md" }]),
    preview(() => "# Saved preview"),
  ]);
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
  const savedWidth = page.waitForResponse(
    (response) =>
      rpcKey(response.request()) === "PreferenceService/UpdatePreferences" &&
      response.request().postDataJSON().layout?.artifactWidth !== undefined,
  );
  await resize.press("ArrowLeft");
  const width = await resize.getAttribute("aria-valuenow");
  await (await savedWidth).finished();
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
    if (rpcKey(request) === "SessionService/UpdateSession")
      patches.push(request.url());
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
  const tree = page.waitForResponse(
    (response) =>
      rpcKey(response.request()) === "WorkspaceService/ListArtifacts",
  );
  await mockUserPreferences(page, undefined, {
    layout: { artifactState: { open: true, workspace: "" } },
  });
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
  await mockApp(
    page,
    Array.from({ length: 40 }, (_, i) =>
      message(i % 2 ? "assistant" : "user", `Message ${i}`),
    ),
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
  appearance: MessageInitShape<
    typeof UpdatePreferencesRequest_AppearancePatchSchema
  >,
) {
  await page.setViewportSize({ width, height: 900 });
  await mockApp(page);
  await mockRpc(page, [
    artifacts(() => [{ name: "notes.md", path: "notes.md" }]),
  ]);
  await mockUserPreferences(page, undefined, {
    appearance: { sidebarAnimationMs: 0, ...appearance },
    layout: { artifactWidth: 560 },
  });
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
    chatWidth: Appearance_ChatWidth.FULL,
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
  const user = "11111111-1111-4111-8111-111111111111";
  const store = new Map([
    [user, userPreferencesSchema.parse({ layout: { artifactWidth: 800 } })],
  ]);
  await page.addInitScript(
    (user) => localStorage.setItem("euler:userUuid", user),
    user,
  );
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockApp(page);
  await mockUserPreferences(page, store);
  await page.goto("/run/sidebar-test");
  await expect(
    page.getByRole("button", { name: "Toggle artifacts" }),
  ).toBeVisible();
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
