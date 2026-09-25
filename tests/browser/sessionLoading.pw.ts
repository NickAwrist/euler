import { type ServerResponse, createServer } from "node:http";
import { type Page, expect, test } from "@playwright/test";

async function mockApp(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "DELETE")
      throw new Error("Navigation must not delete an unloaded conversation");
    const json =
      path === "/api/sessions"
        ? {
            sessions: ["a", "b"].map((id) => ({
              id,
              preview: `Conversation ${id}`,
              createdAt: 1,
              updatedAt: 1,
            })),
          }
        : path === "/api/models"
          ? {
              models: [
                {
                  id: "test",
                  name: "Test",
                  lab: "Test",
                  provider: "ollama",
                  inputCapabilities: ["text", "image"],
                },
              ],
            }
          : path.endsWith("/health")
            ? { connected: true }
            : path.startsWith("/api/runs/active/")
              ? { active: false }
              : {};
    await route.fulfill({ json });
  });
}

function stored(id: string, content: string, image = false) {
  return {
    id,
    model: "test",
    history: [
      {
        role: "user",
        content,
        ...(image
          ? {
              attachments: [
                {
                  id: "image",
                  kind: "image",
                  name: "Pasted image",
                  mimeType: "image/png",
                  size: 10,
                },
              ],
            }
          : {}),
      },
    ],
  };
}

test("session loading displays history and permits navigation while run status and images are held", async ({
  page,
}) => {
  await mockApp(page);
  const status = Promise.withResolvers<void>();
  const images = Promise.withResolvers<void>();
  let statusCompleted = false;
  let imageStarted = false;
  const sessions: string[] = [];
  await page.route("**/api/sessions/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    sessions.push(id);
    await route.fulfill({ json: stored(id, `Stored text ${id}`, true) });
  });
  await page.route("**/api/runs/active/*", async (route) => {
    await status.promise;
    await route.fulfill({ json: { active: false } });
    statusCompleted = true;
  });
  await page.route("**/api/attachments/*", async (route) => {
    imageStarted = true;
    await images.promise;
    await route.abort();
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: /Conversation a/ })
      .first()
      .click();
    await expect(
      page.getByText("Stored text a", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => imageStarted).toBe(true);
    await page.getByPlaceholder("Send a message...").fill("test");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: /Conversation b/ })
      .first()
      .click();
    await expect(
      page.getByText("Stored text b", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Stored text a", { exact: true })).toHaveCount(
      0,
    );
    await page.waitForTimeout(3000);
    expect(statusCompleted).toBe(false);
    expect(sessions).toEqual(["a", "b"]);
    await page.getByPlaceholder("Send a message...").fill("test");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    status.resolve();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
  } finally {
    status.resolve();
    images.resolve();
  }
});

test("session loading distinguishes loading, errors, and loaded empty", async ({
  page,
}) => {
  await mockApp(page);
  const history = Promise.withResolvers<void>();
  let fail = true;
  await page.route("**/api/sessions/a", async (route) => {
    await history.promise;
    await route.fulfill(
      fail
        ? { status: 500, json: { error: "History unavailable" } }
        : { json: { id: "a", history: [], model: "test" } },
    );
  });
  await page.goto("/run/a");
  await expect(
    page.getByText("Loading conversation…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Start the session with a message below."),
  ).toHaveCount(0);
  history.resolve();
  await expect(
    page.getByText("History unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Start the session with a message below."),
  ).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Start the session with a message below."),
  ).toBeVisible();
});

test("session loading never replaces streamed completion with an older pending snapshot", async ({
  page,
}) => {
  await mockApp(page);
  const oldHistory = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/api/sessions/a", async (route) => {
    const initial = ++requests === 1;
    if (initial) await oldHistory.promise;
    await route.fulfill({
      json: stored(
        "a",
        initial ? "Stale snapshot" : "Completed stream history",
      ),
    });
  });
  await page.route("**/api/runs/active/a", (route) =>
    route.fulfill({ json: { active: true, requestId: "run" } }),
  );
  await page.route("**/api/runs/stream/a", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"run_done"}\n\n',
    }),
  );
  try {
    await page.goto("/run/a");
    await expect(
      page.getByText("Completed stream history", { exact: true }),
    ).toBeVisible();
    oldHistory.resolve();
    await expect(
      page.getByText("Loading conversation…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Completed stream history", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Stale snapshot", { exact: true })).toHaveCount(
      0,
    );
    expect(requests).toBe(2);
  } finally {
    oldHistory.resolve();
  }
});

test("session loading ignores a departed conversation and keeps sending disabled on status failure", async ({
  page,
}) => {
  await mockApp(page);
  const oldHistory = Promise.withResolvers<void>();
  await page.route("**/api/sessions/a", async (route) => {
    await oldHistory.promise;
    await route.fulfill({ json: stored("a", "Departed history") });
  });
  await page.route("**/api/sessions/b", (route) =>
    route.fulfill({ json: stored("b", "Current history") }),
  );
  await page.route("**/api/runs/active/b", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  try {
    await page.goto("/run/a");
    await expect(
      page.getByText("Loading conversation…", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Conversation b/ })
      .first()
      .click();
    await expect(
      page.getByText("Current history", { exact: true }),
    ).toBeVisible();
    oldHistory.resolve();
    await expect(
      page.getByText("Could not check the active run.", { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("Send a message...").fill("test");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Departed history", { exact: true }),
    ).toHaveCount(0);
  } finally {
    oldHistory.resolve();
  }
});

test("session loading restores concurrent run traces after switching and refresh", async ({
  page,
}) => {
  await mockApp(page);
  await page.route("**/api/sessions/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ json: stored(id, `Stored text ${id}`) });
  });
  await page.route("**/api/runs/active/*", (route) =>
    route.fulfill({
      json: { active: true, requestId: route.request().url() },
    }),
  );
  // Keep SSE bodies open, as they are while a server generation is running.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const isSend = url === "/api/runs" && init?.method === "POST";
      if (!url.includes("/api/runs/stream/") && !isSend)
        return originalFetch(input, init);
      const id = isSend
        ? JSON.parse(String(init?.body)).sessionId
        : url.split("/").at(-1);
      const step = {
        kind: "tool_call",
        status: "running",
        toolName: `working_${id}`,
      };
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "run_step", step, steps: [step] })}\n\n`,
              ),
            );
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    window.fetch = new Proxy(originalFetch, {
      apply: (_target, _thisArg, args: [RequestInfo | URL, RequestInit?]) =>
        mockFetch(...args),
    });
  });
  const trace = page.getByRole("button", { name: "View execution trace" });
  await page.route("**/api/runs/active/a", (route) =>
    route.fulfill({ json: { active: false } }),
  );
  await page.goto("/run/a");
  await page.getByPlaceholder("Send a message...").fill("Start generation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.unroute("**/api/runs/active/a");
  await expect(trace).toContainText("Working A");
  // Navigating to an idle thread must not erase the still-connected buffer.
  await page.route("**/api/runs/active/b", (route) =>
    route.fulfill({ json: { active: false } }),
  );
  await page
    .getByRole("button", { name: /Conversation b/ })
    .first()
    .click();
  await expect(trace).toHaveCount(0);
  await page
    .getByRole("button", { name: /Conversation a/ })
    .first()
    .click();
  await expect(trace).toContainText("Working A");
  await page.unroute("**/api/runs/active/b");
  await page
    .getByRole("button", { name: /Conversation b/ })
    .first()
    .click();
  await expect(trace).toContainText("Working B");
  await page.reload();
  await expect(trace).toContainText("Working B");
  await page
    .getByRole("button", { name: /Conversation a/ })
    .first()
    .click();
  await expect(trace).toContainText("Working A");
  await page
    .getByRole("button", { name: /Conversation b/ })
    .first()
    .click();
  await expect(trace).toContainText("Working B");
});

test("session loading recovers real streams through repeated refreshes and connection failures", async ({
  page,
}) => {
  await mockApp(page);
  const clients = new Set<ServerResponse>();
  let streamRequests = 0;
  let completed = false;
  let failedStatusChecks = 0;
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] ?? "*",
    );
    if (req.method === "OPTIONS") {
      res.end();
      return;
    }
    if (completed) {
      res.writeHead(404).end();
      return;
    }
    if (++streamRequests === 1) {
      res.writeHead(503).end();
      return;
    }
    const id = req.url?.split("/").at(-1);
    const step = {
      kind: "tool_call",
      status: "running",
      toolName: `working_${id}`,
    };
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.write(
      `data: ${JSON.stringify({ type: "run_started", requestId: id })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ type: "run_step", step, steps: [step] })}\n\n`,
    );
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server port");
  await page.addInitScript((port) => {
    const original = window.fetch;
    window.fetch = new Proxy(original, {
      apply: (_target, _thisArg, args: [RequestInfo | URL, RequestInit?]) => {
        const [input, init] = args;
        const url = String(input);
        return original(
          url.includes("/api/runs/stream/")
            ? `http://127.0.0.1:${port}/stream/${url.split("/").at(-1)}`
            : input,
          init,
        );
      },
    });
  }, address.port);
  await page.route("**/api/sessions/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({
      json: stored(
        id,
        completed ? "Completed after disconnect" : `Stored text ${id}`,
      ),
    });
  });
  let statusRequests = 0;
  await page.route("**/api/runs/active/*", (route) => {
    statusRequests++;
    if (failedStatusChecks > 0) {
      failedStatusChecks--;
      return route.fulfill({ status: 503, json: {} });
    }
    if (completed) return route.fulfill({ json: { active: false } });
    // Model the preparation window before a generation becomes discoverable.
    if (statusRequests === 1) return route.fulfill({ json: { active: false } });
    if (statusRequests === 2) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: { active: true, requestId: "run" } });
  });
  const trace = page.getByRole("button", { name: "View execution trace" });
  try {
    await page.goto("/run/a");
    await expect(trace).toContainText("Working A", { timeout: 15000 });
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect(trace).toContainText("Working A");
    }
    // A dropped TCP connection must resume without another navigation.
    for (const client of clients) client.destroy();
    const beforeRecovery = streamRequests;
    await expect.poll(() => streamRequests).toBeGreaterThan(beforeRecovery);
    await expect(trace).toContainText("Working A");
    await page
      .getByRole("button", { name: /Conversation b/ })
      .first()
      .click();
    await expect(trace).toContainText("Working B");
    await page
      .getByRole("button", { name: /Conversation a/ })
      .first()
      .click();
    await expect(trace).toContainText("Working A");
    completed = true;
    failedStatusChecks = 2;
    for (const client of clients) client.destroy();
    await expect(
      page.getByText("Completed after disconnect", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(trace).toHaveCount(0);
  } finally {
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("session loading retries failed run discovery and restores sending", async ({
  page,
}) => {
  await mockApp(page);
  await page.route("**/api/sessions/a", (route) =>
    route.fulfill({ json: stored("a", "Stored text a") }),
  );
  let attempts = 0;
  await page.route("**/api/runs/active/a", (route) => {
    return route.fulfill(
      ++attempts < 3 ? { status: 503, json: {} } : { json: { active: false } },
    );
  });
  await page.goto("/run/a");
  await page.getByPlaceholder("Send a message...").fill("Next message");
  await expect(
    page.getByText("Could not check the active run.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Could not check the active run.", { exact: true }),
  ).toHaveCount(0);
});
