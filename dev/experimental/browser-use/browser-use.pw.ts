import { expect, test } from "@playwright/test";
import { captureMock, expectScenesFitMobile } from "../shared/capture";

const route = "/dev/experimental/browser-use";
const capture = (page: Parameters<typeof captureMock>[0], name: string) =>
  captureMock(page, "browser-use", name);

test("manual takeover requires acknowledgement and explicit resume", async ({
  page,
}) => {
  await page.goto(route);
  const browser = page.getByRole("region", { name: "Shared browser" });
  await expect(browser).toHaveAttribute("data-control", "agent");
  await capture(page, "agent-inline");
  await page
    .getByRole("button", { name: "Stop agent and take control" })
    .click();
  await expect(browser).toHaveAttribute("data-control", "stopping");
  await expect(
    page.getByRole("button", { name: "Stop agent and take control" }),
  ).toBeDisabled();
  await expect(browser).toHaveAttribute("data-control", "user");
  await expect(browser).not.toHaveClass(/mock-agent-control/);
  await page.getByRole("button", { name: "Collapse browser" }).click();
  await expect(browser).toHaveAttribute("data-control", "user");
  await page.getByRole("button", { name: "Resume agent" }).click();
  await expect(browser).toHaveAttribute("data-control", "agent");
});

test("agent can yield for login; resume stays available to the user", async ({
  page,
}) => {
  await page.goto(route);
  await page
    .getByRole("button", { name: "Simulate agent requesting login" })
    .click();
  await expect(
    page.getByRole("button", { name: "Simulate sign in" }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("region", { name: "Shared browser" })
      .getByText(/Parcel needs you to sign in/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume agent" }),
  ).toBeEnabled();
  await capture(page, "private-login");
  await page.getByRole("button", { name: "Simulate sign in" }).click();
  await expect(
    page.getByRole("region", { name: "Shared browser" }),
  ).toHaveAttribute("data-control", "user");
});

test("finishing replaces the live browser with a completed task", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Simulate agent finishing" }).click();
  await expect(
    page.getByRole("region", { name: "Shared browser" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Browser agent" })
      .getByText("Completed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/is Ready/)).toBeVisible();
  await capture(page, "agent-finished");
});

test("ending the task from user control keeps the chat usable", async ({
  page,
}) => {
  await page.goto(`${route}?scene=login`);
  await page.getByRole("button", { name: "End task" }).click();
  await expect(
    page
      .getByRole("region", { name: "Browser agent" })
      .getByText("Cancelled", { exact: true }),
  ).toBeVisible();
});

test("selection makes a draft reference while control stays private", async ({
  page,
}) => {
  await page.goto(`${route}?scene=selection`);
  await page
    .getByRole("button", { name: "Select deployment: Improve worker shutdown" })
    .click();
  await expect(
    page.getByText("Selected: Improve worker shutdown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Shared browser" }),
  ).toHaveAttribute("data-control", "user");
  await capture(page, "selection");
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(
    page.getByText("Selected: Improve worker shutdown", { exact: true }),
  ).toHaveCount(0);
});

test("reset confirmation supports cancellation and returns focus", async ({
  page,
}) => {
  await page.goto(`${route}?scene=settings`);
  await expect(
    page.getByRole("heading", { name: "Your browser", exact: true }),
  ).toBeVisible();
  await capture(page, "settings");
  const trigger = page.getByRole("button", {
    name: "Reset browser…",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Reset your browser?" });
  await expect(dialog).toBeVisible();
  await capture(page, "reset-confirmation");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Reset browser", exact: true })
    .click();
  await expect(page.getByText("Empty profile", { exact: true })).toBeVisible();
});

test("mobile mock stays within viewport and supports takeover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route);
  await page
    .getByRole("button", { name: "Stop agent and take control" })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume agent" }),
  ).toBeVisible();
  await expectScenesFitMobile(page, route, [
    "agent",
    "login",
    "finished",
    "selection",
    "settings",
  ]);
});
