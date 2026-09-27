import { expect, test } from "@playwright/test";
import { captureMock, expectScenesFitMobile } from "../shared/capture";

const route = "/dev/experimental/async-agents";
const capture = (page: Parameters<typeof captureMock>[0], name: string) =>
  captureMock(page, "async-agents", name);

test("a background agent keeps the chat usable and can be stopped", async ({
  page,
}) => {
  await page.goto(route);
  const card = page.getByRole("region", { name: "Research agent" });
  await expect(card.getByText("Running", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Message Euler. The research agent keeps working."),
  ).toBeVisible();
  await capture(page, "background-agent");
  await card.getByRole("button", { name: "Stop research agent" }).click();
  await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Stop/ })).toHaveCount(0);
});

test("Euler answers unrelated and progress questions while the agent runs", async ({
  page,
}) => {
  await page.goto(`${route}?scene=chatting`);
  await expect(
    page
      .getByRole("region", { name: "Research agent" })
      .getByText("Running", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("How's the benchmark going?")).toBeVisible();
  await expect(page.getByText(/Two of three are done/)).toBeVisible();
  await capture(page, "chat-while-running");
});

test("an agent question wakes Euler and a reply resumes the agent", async ({
  page,
}) => {
  await page.goto(`${route}?scene=question`);
  const card = page.getByRole("region", { name: "Research agent" });
  await expect(
    card.getByText("Waiting for Euler", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/needs a decision/)).toBeVisible();
  const panelTrigger = page.getByRole("button", {
    name: "Research agent details",
  });
  await capture(page, "agent-question");
  await page.getByRole("button", { name: "Simulate your answer" }).click();
  await expect(card.getByText("Running", { exact: true })).toBeVisible();
  await panelTrigger.click();
  await expect(
    page
      .getByRole("list", { name: "Agent messages" })
      .getByText("The user says to start the container."),
  ).toBeVisible();
});

test("a result arriving mid-reply queues in the panel, not the chat", async ({
  page,
}) => {
  await page.goto(`${route}?scene=inflight&panel=detail`);
  const card = page.getByRole("region", {
    name: "Research agent",
    exact: true,
  });
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText(/queued/i)).toHaveCount(0);
  const panel = page.getByRole("complementary", { name: "Artifacts" });
  await expect(
    panel
      .getByRole("list", { name: "Agent messages" })
      .getByText(/queued for Euler's next step/),
  ).toBeVisible();
  await capture(page, "queued-mid-reply");
  await page.getByRole("button", { name: "Simulate step boundary" }).click();
  await expect(panel.getByText(/queued/i)).toHaveCount(0);
  await expect(page.getByText(/Change it to 30000/)).toBeVisible();
  await page.keyboard.press("Escape");
  await capture(page, "delivered-mid-reply");
});

test("agent events stay out of the transcript", async ({ page }) => {
  for (const scene of ["question", "inflight", "finished"]) {
    await page.goto(`${route}?scene=${scene}`);
    if (scene === "inflight")
      await page
        .getByRole("button", { name: "Simulate step boundary" })
        .click();
    const conversation = page.getByRole("region", { name: "Conversation" });
    await expect(
      conversation.getByText(/agent (asked|finished)|queued|stopped/i),
    ).toHaveCount(0);
  }
});

test("the transcript row shows only name, status, and controls", async ({
  page,
}) => {
  await page.goto(route);
  const card = page.getByRole("region", { name: "Research agent" });
  await expect(card).toContainText("Benchmark queue libraries");
  await expect(card.getByText("Running BullMQ throughput test")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(2);
});

test("completion wakes an idle Euler without a user message", async ({
  page,
}) => {
  await page.goto(`${route}?scene=finished`);
  const card = page.getByRole("region", { name: "Research agent" });
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Stop/ })).toHaveCount(0);
  await expect(page.getByText(/The benchmark is done/)).toBeVisible();
  await capture(page, "agent-finished");
});

test("the agents panel lists agents, shows detail, and returns focus", async ({
  page,
}) => {
  await page.goto(`${route}?scene=finished`);
  const trigger = page.getByRole("button", { name: "Research agent details" });
  await trigger.click();
  const panel = page.getByRole("complementary", { name: "Artifacts" });
  const inbox = panel.getByRole("list", { name: "Agent messages" });
  await expect(inbox.getByRole("listitem")).toHaveCount(6);
  await expect(inbox.getByText("does not wake Euler")).toHaveCount(2);
  await capture(page, "agents-panel-detail");
  await panel.getByText("Activity", { exact: true }).click();
  await expect(
    panel.getByRole("list", { name: "Agent activity" }).getByRole("listitem"),
  ).toHaveCount(10);
  await panel.getByRole("button", { name: "All agents" }).click();
  await expect(
    panel
      .getByRole("list", { name: "Agents in this chat" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    panel.getByRole("button", { name: /^Benchmark queue libraries/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a running agent can be stopped from the agents panel", async ({
  page,
}) => {
  await page.goto(`${route}?scene=chatting&panel=list`);
  const panel = page.getByRole("complementary", { name: "Artifacts" });
  await expect(panel.getByText("Agents (1)")).toBeVisible();
  await capture(page, "agents-panel");
  await panel
    .getByRole("button", { name: "Stop Benchmark queue libraries" })
    .click();
  await expect(panel.getByText("Agents", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Research agent" })
      .getByText("Cancelled", { exact: true }),
  ).toBeVisible();
});

test("sidebar badges name chat activity for assistive technology", async ({
  page,
}) => {
  await page.goto(route);
  const chats = page.getByRole("list", { name: "Chats" });
  await expect(chats.getByRole("img", { name: "Needs you" })).toBeVisible();
  await expect(chats.getByRole("img", { name: "New reply" })).toBeVisible();
  await expect(chats.getByRole("img", { name: "Agent working" })).toBeVisible();
});

test("mobile mock stays within the viewport", async ({ page }) => {
  await expectScenesFitMobile(page, route, [
    "started",
    "chatting",
    "question",
    "inflight",
    "finished",
    "finished&panel=detail",
  ]);
});
