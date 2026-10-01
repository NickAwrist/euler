import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
test.use({
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  video: "on",
});
const evidence = resolve(".cache/jobs-evidence");
let server: ChildProcess;
test.beforeAll(async () => {
  mkdirSync(evidence, { recursive: true });
  server = spawn("bun", ["tests/helpers/asyncFixture.ts"], {
    stdio: "pipe",
    env: {
      ...process.env,
      JOB_FIXTURE: "1",
      JOB_FIXTURE_PORT: "5197",
    },
  });
  server.stdout?.on("data", (chunk) =>
    appendFileSync(`${evidence}/backend.log`, chunk),
  );
  server.stderr?.on("data", (chunk) =>
    appendFileSync(`${evidence}/backend.log`, chunk),
  );
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
test("session loading: background Bash jobs complete after ten seconds and remain inspectable after reload", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
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
    url.port = "5197";
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
  await input.fill(
    "Run a Bash script in the background that waits 10 seconds, then reports JOB_DONE.",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText(
      "The script is running in the background. You can keep chatting.",
      { exact: true },
    ),
  ).toBeVisible();
  const inlineJob = page.getByRole("button", { name: /bash · running/ });
  await expect(inlineJob).toBeVisible();
  await inlineJob.click();
  const jobModal = page.getByRole("dialog", { name: "Job details" });
  await expect(
    jobModal.getByRole("heading", {
      name: "Input",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    jobModal.getByRole("heading", { name: "Output", exact: true }),
  ).toBeVisible();
  await expect(jobModal.getByLabel("Job timing")).toContainText("Started");
  await expect(jobModal.getByLabel("Job timing")).toContainText(
    "Still running",
  );
  await expect(jobModal.getByLabel("Job input")).toContainText("sleep 7");
  await expect(jobModal.getByLabel("Job output")).toContainText("JOB_STARTED");
  await expect(jobModal.getByLabel("Job output").locator("pre")).toHaveCount(1);
  await expect(jobModal.getByLabel("Job output")).toContainText(
    "JOB_PROGRESS",
    { timeout: 6000 },
  );
  await expect(jobModal.getByLabel("Job elapsed time")).toContainText(/[3-9]s/);
  await page.screenshot({ path: `${evidence}/running.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Jobs").getByText("bash · running", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Jobs")
    .getByRole("button", { name: /bash · running/ })
    .click();
  await expect(page.getByLabel("Job output")).toContainText("JOB_STARTED");
  await page.keyboard.press("Escape");
  await input.fill("How is it going?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("The background script is still running.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      "The background script finished. JOB_DONE was received automatically.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("Jobs")
    .getByRole("button", { name: /bash · succeeded/ })
    .click();
  await expect(page.getByLabel("Job output").locator("pre")).toHaveText(
    "JOB_STARTED\nJOB_PROGRESS\nJOB_DONE\n",
  );
  await expect(
    jobModal.getByRole("heading", {
      name: "Output",
      exact: true,
    }),
  ).toBeVisible();
  await expect(jobModal.getByLabel("Job output")).not.toContainText(
    "Exit code",
  );
  await expect(jobModal.getByLabel("Job progress")).toHaveCount(0);
  const metadata = jobModal.getByLabel("Job metadata");
  await expect(
    metadata.getByText("Exit code", { exact: true }),
  ).not.toBeVisible();
  await metadata.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(metadata.locator("dd")).toHaveText("0");
  await page.keyboard.press("Enter");
  await expect(metadata.locator("dd")).not.toBeVisible();
  await expect(jobModal.getByLabel("Job timing")).toContainText("Finished");
  await expect(jobModal.getByLabel("Job timing")).toContainText("Duration");
  await expect(jobModal.getByLabel("Job timing").locator("time")).toHaveCount(
    2,
  );
  const completedDuration = await jobModal
    .getByLabel("Job elapsed time")
    .textContent();
  await page.waitForTimeout(1100);
  await expect(jobModal.getByLabel("Job elapsed time")).toHaveText(
    completedDuration!,
  );
  await page.screenshot({ path: `${evidence}/completed.png` });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${evidence}/sidebar.png` });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByText("result.txt", { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await input.fill("command:echo CANCELLATION_READY; sleep 30");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .getByText(
        "The script is running in the background. You can keep chatting.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByLabel("Jobs")
    .getByRole("button", { name: "Cancel job", exact: true })
    .click();
  await expect(
    page.getByLabel("Jobs").getByText("bash · cancelled", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Jobs")
    .getByRole("button", { name: /bash · cancelled/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Job details" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(consoleErrors).toEqual([]);
});
