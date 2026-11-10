import { expect, test } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { FIXTURE_MODEL, startAsyncBackend, useBackend } from "./asyncBackend";
import { RpcFailure, mockRpc, on } from "./rpcMock";
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
test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
let server: Awaited<ReturnType<typeof startAsyncBackend>>;
test.beforeAll(async () => {
  server = await startAsyncBackend({ port: 5198 });
});
test.afterAll(async () => server?.stop());

test("session loading: async agents continue across chat messages and browser reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await useBackend(page, server.url);
  await mockUserPreferences(page, undefined, {
    settings: { defaultModel: FIXTURE_MODEL },
  });
  await page.goto("/");
  const input = page.getByPlaceholder("Send a message...");
  await input.fill("Research this");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Working in the background.", { exact: true }),
  ).toBeVisible();
  await input.fill("How is it going?");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("How is it going?", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("The background result is 42.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  const agentRow = page.getByRole("button", {
    name: "Research gpt-5.6-terra Ready",
    exact: true,
  });
  await agentRow.click();
  const trace = page.getByRole("dialog", { name: "Research" });
  await expect(trace.getByText("Ready", { exact: true })).toBeVisible();
  await expect(trace.getByText("42", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: testInfo.outputPath("async-agent-completed.png"),
  });
  await page.keyboard.press("Escape");
  await expect(trace).toHaveCount(0);
  await expect(agentRow).toBeFocused();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const listRow = page
    .getByLabel("Agents")
    .getByRole("button", { name: /^Research/ });
  await listRow.click();
  await expect(trace).toBeVisible();
  await page.keyboard.press("Escape");
  const agentsList = page.getByLabel("Agents");
  await expect(
    agentsList.getByRole("heading", { name: "Ready 1" }),
  ).toBeVisible();
  await agentsList.getByRole("button", { name: "Dismiss Research" }).click();
  const ended = agentsList.getByRole("button", { name: "Ended 1" });
  await expect(ended).toHaveAttribute("aria-expanded", "false");
  await expect(listRow).toBeHidden();
  await ended.click();
  await expect(listRow).toContainText("Done");
  await input.fill("Slow reply");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Stop generation" }),
  ).toBeVisible();
  await input.fill("Queued original");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Queued: Queued original", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await input.fill("Draft");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByText("Queued: Queued original", { exact: true }),
  ).toHaveCount(0);
  await expect(input).toHaveValue("Queued original\nDraft");
  await input.fill("Queued edited");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Queued edited", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await listRow.click();
  await expect(trace).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("async-agents-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await expect(trace).toHaveCount(0);
  await page.keyboard.press("Escape");
  await mockRpc(page, [
    on(
      AgentService.method.sendMessage,
      () =>
        new RpcFailure(
          "invalid_argument",
          "Message rejected",
          "INVALID_REQUEST",
        ),
    ),
  ]);
  await input.fill("Retain this draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Message rejected", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("Retain this draft");
});
