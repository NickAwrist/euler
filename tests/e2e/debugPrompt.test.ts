import "../setup";
import { expect, test } from "bun:test";
import { createSkillRow, setOpenRouterApiKey } from "../../src/db";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

test("POST /api/runs/debug-prompt returns the server-rendered system prompt", async () => {
  const { url, close } = await startTestServer();
  try {
    // 1. Default request with no metadata includes current date and core directives
    const res1 = await fetch(`${url}/api/runs/debug-prompt`, {
      method: "POST",
      headers: userHeaders(undefined, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { systemPrompt: string };
    expect(data1.systemPrompt).toBeString();
    expect(data1.systemPrompt).toContain("Current date:");
    expect(data1.systemPrompt).toContain("<tool_format>");
    expect(data1.systemPrompt).toContain("<agency>");

    // 2. Request with includeCurrentDate: false omits the date
    const res2 = await fetch(`${url}/api/runs/debug-prompt`, {
      method: "POST",
      headers: userHeaders(undefined, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        metadata: {
          includeCurrentDate: false,
        },
      }),
    });
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { systemPrompt: string };
    expect(data2.systemPrompt).not.toContain("Current date:");
    expect(data2.systemPrompt).toContain("<tool_format>");

    // 3. Request with custom metadata includes personalization fields
    const res3 = await fetch(`${url}/api/runs/debug-prompt`, {
      method: "POST",
      headers: userHeaders(undefined, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        metadata: {
          name: "Alice",
          location: "Wonderland",
          preferredFormats: "markdown tables",
          includeCurrentDate: true,
        },
      }),
    });
    expect(res3.status).toBe(200);
    const data3 = (await res3.json()) as { systemPrompt: string };
    expect(data3.systemPrompt).toContain("User name: Alice");
    expect(data3.systemPrompt).toContain("Location: Wonderland");
    expect(data3.systemPrompt).toContain(
      "Preferred response format: markdown tables",
    );
    expect(data3.systemPrompt).toContain("Current date:");
  } finally {
    await close();
  }
});

for (const includeCurrentDate of [undefined, false]) {
  test(`run sends the same custom prompt as the preview with date ${includeCurrentDate === false ? "disabled" : "defaulted"}`, async () => {
    const { url, close } = await startTestServer();
    setOpenRouterApiKey("sk-or-prompt-test");
    const lease = await workspaceService.createTemporary(TEST_USER_ID);
    try {
      const skill = createSkillRow(TEST_USER_ID, {
        name: "prompt-check",
        description: "Check prompts",
        instructions: "Verify every instruction.",
      });
      const input = {
        sessionId: lease.id,
        ephemeral: true,
        message: "Use $prompt-check",
        metadata: {
          systemPrompt:
            "Follow these instructions.\n{{PERSONALIZATION}}\n{{SESSION_DIRECTORY}}\n{{OS}}",
          includeCurrentDate,
        },
      };
      const preview = await fetch(`${url}/api/runs/debug-prompt`, {
        method: "POST",
        headers: userHeaders(undefined, { "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      });
      expect(preview.status).toBe(200);
      const { systemPrompt } = (await preview.json()) as {
        systemPrompt: string;
      };
      expect(systemPrompt).toContain(skill.instructions);
      expect(systemPrompt.includes("Current date:")).toBe(
        includeCurrentDate === undefined,
      );
      expect(systemPrompt).toStartWith("Follow these instructions.");
      expect(systemPrompt).toContain("<tool_format>");
      const run = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: userHeaders(undefined, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...input,
          history: [],
          model: "openrouter:openai/gpt-5.4-mini",
        }),
      });
      expect(run.status).toBe(200);
      await run.text();
      expect(getOpenRouterRequests()).toHaveLength(1);
      const messages = getOpenRouterRequests()[0]!.body.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0]).toEqual({ role: "system", content: systemPrompt });
    } finally {
      await workspaceService.deleteTemporary(TEST_USER_ID, lease.id);
      await close();
    }
  });
}

test("debug preview rejects invalid sessions and expired workspaces", async () => {
  const { url, close } = await startTestServer();
  try {
    for (const [body, status] of [
      [{ sessionId: "missing-session" }, 404],
      [{ sessionId: "expired-lease", ephemeral: true }, 400],
      [{ metadata: { includeCurrentDate: "false" } }, 400],
    ] as const) {
      const response = await fetch(`${url}/api/runs/debug-prompt`, {
        method: "POST",
        headers: userHeaders(undefined, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).not.toHaveProperty("systemPrompt");
    }
  } finally {
    await close();
  }
});
