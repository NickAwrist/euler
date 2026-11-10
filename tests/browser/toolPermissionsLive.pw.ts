import { type Page, expect, test } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { PreferenceService } from "../../src/gen/euler/v1/preferences_pb";
import { fromProtoRule, toProtoRule } from "../../src/permissions/wire";
import type { ToolPermissionRule } from "../../src/schemas/toolPermissions";
import {
  FIXTURE_MODEL,
  backendClient,
  startAsyncBackend,
  useBackend,
} from "./asyncBackend";

// Real Express/SQLite/runtime/Bash backend; only the model catalog is mocked.
const USER = "12345678-1234-4234-9234-123456789abc";
const COMMAND = "echo approved >> marker.txt";
const REPLY = "The script is running in the background. You can keep chatting.";
const ASK_ALL: ToolPermissionRule = {
  id: "66666666-6666-4666-8666-666666666666",
  tool: "*",
  action: "ask",
  condition: { kind: "any" },
};
let server: Awaited<ReturnType<typeof startAsyncBackend>>;
let preferences: ReturnType<typeof backendClient<typeof PreferenceService>>;
let agents: ReturnType<typeof backendClient<typeof AgentService>>;

test.beforeAll(async () => {
  // Each parallel worker gets its own backend.
  server = await startAsyncBackend({
    port: 5196 - Number(process.env.TEST_PARALLEL_INDEX ?? 0),
    mode: "permissions",
  });
  preferences = backendClient(server.url, PreferenceService, USER);
  agents = backendClient(server.url, AgentService, USER);
});
test.afterAll(async () => server?.stop());

/** The user's saved rules, as the server stores them. */
const savedRules = async () =>
  (
    (await preferences.getPreferences({})).preferences?.toolPermissionRules ??
    []
  ).map(fromProtoRule);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem("euler:userUuid", user);
  }, USER);
  await useBackend(page, server.url);
  await preferences.updatePreferences({
    settings: { defaultModel: FIXTURE_MODEL },
  });
  // Every test starts from a single ask-all rule.
  for (const rule of await savedRules())
    await preferences.deletePermissionRule({ ruleId: rule.id });
  await preferences.putPermissionRule({ rule: toProtoRule(ASK_ALL) });
});

const pendingApprovals = async (session: string) =>
  (await agents.getRuntime({ sessionId: session })).approvals;

async function sendCommand(page: Page) {
  await page.getByPlaceholder("Send a message...").fill(`command:${COMMAND}`);
  await page.getByRole("button", { name: "Send message" }).click();
}

const approvalCard = (page: Page) =>
  page
    .getByRole("region", { name: "Tool approvals" })
    .getByRole("article", { name: /wants to run bash/ });

const sessionFrom = (page: Page) => new URL(page.url()).pathname.split("/")[2]!;

test.describe("wide", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });

  test("tools desktop: live approval saves an exact rule that skips later identical calls", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await sendCommand(page);
    const card = approvalCard(page);
    await expect(card.getByLabel("bash arguments")).toContainText(COMMAND);
    await expect(card).toContainText(
      "Matching calls: Identical arguments in this chat and workspace",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/run\//);
    const session = sessionFrom(page);

    // Pending approvals come from the runtime snapshot, so they survive reload.
    await page.reload();
    await expect(card).toBeVisible();
    const input = page.getByPlaceholder("Send a message...");
    const cardBox = await card.boundingBox();
    const inputBox = await input.boundingBox();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(inputBox!.y);
    expect(cardBox!.width).toBeGreaterThan(600);
    await input.fill("Draft while waiting");
    await expect(input).toHaveValue("Draft while waiting");
    await page.screenshot({ path: testInfo.outputPath("pending-wide.png") });
    expect(await pendingApprovals(session)).toHaveLength(1);

    await card.getByRole("button", { name: "Allow matching calls" }).click();
    await expect(card).toBeHidden();
    await expect(page.getByText(REPLY, { exact: true })).toHaveCount(1);
    expect(await pendingApprovals(session)).toEqual([]);
    expect(await savedRules()).toEqual([
      ASK_ALL,
      expect.objectContaining({
        tool: "bash",
        action: "allow",
        condition: {
          kind: "arguments",
          value: expect.objectContaining({ command: COMMAND }),
        },
        sessionId: session,
      }),
    ]);

    await input.fill("");
    await sendCommand(page);
    await expect(page.getByText(REPLY, { exact: true })).toHaveCount(2);
    await expect(card).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Removed the rule for bash.")).toBeVisible();
    await expect.poll(savedRules).toEqual([ASK_ALL]);

    // Without the rule the identical call asks again; stopping cancels it.
    await sendCommand(page);
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Stop generation" }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => pendingApprovals(session)).toEqual([]);
    await page.reload();
    await expect(page.getByText(REPLY, { exact: true })).toHaveCount(2);
    await expect(card).toHaveCount(0);
  });
});

test("composer selectors mobile: live tool approval denies inline without a stale request", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await sendCommand(page);
  const card = approvalCard(page);
  await expect(card).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = page.getByPlaceholder("Send a message...");
  const cardBox = await card.boundingBox();
  expect(cardBox!.x).toBeGreaterThanOrEqual(0);
  expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(390);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(
    (await input.boundingBox())!.y,
  );
  await input.fill("Draft while waiting");
  await page.screenshot({ path: testInfo.outputPath("pending-narrow.png") });
  const session = sessionFrom(page);

  await card.getByRole("button", { name: "Deny" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible();
  await expect(input).toHaveValue("Draft while waiting");
  expect(await pendingApprovals(session)).toEqual([]);
  expect(
    (await savedRules()).filter((rule) => rule.sessionId === session),
  ).toEqual([]);
  await page.reload();
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
});
