import { type ChildProcess, spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
let server: ChildProcess;
test.beforeAll(async () => {
  server = spawn("bun", ["tests/helpers/asyncFixture.ts"], { stdio: "pipe" });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture failed to start")),
      10000,
    );
    server.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("async fixture ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited ${code}`));
    });
  });
});
test.afterAll(() => server?.kill());

test("session loading: async agents continue across chat messages and browser reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/models")
      return route.fulfill({
        json: {
          models: [
            {
              id: "openrouter:openai/gpt-5.6-terra",
              name: "Fixture",
              provider: "openrouter",
              lab: "Test",
              configured: true,
              inputCapabilities: ["text"],
            },
          ],
        },
      });
    url.port = "5198";
    return route.continue({ url: url.toString() });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "euler:userSettings",
      JSON.stringify({ defaultModel: "openrouter:openai/gpt-5.6-terra" }),
    ),
  );
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
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit queued message" })
    .fill("Queued edited");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Queued: Queued edited", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Deliver", exact: true }).click();
  await expect(page.getByText("Queued edited", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Queued: Queued edited", { exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await listRow.click();
  await expect(trace).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("async-agents-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await expect(trace).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.route("**/api/sessions/*/messages", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "BAD_REQUEST", message: "Message rejected" } },
    }),
  );
  await input.fill("Retain this draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Message rejected", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("Retain this draft");
});
