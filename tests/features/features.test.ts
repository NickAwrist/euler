import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import {
  createSkillRow,
  deleteSkillRow,
  ensureUserData,
  listSkills,
  setBraveSearchApiKey,
  setOpenRouterApiKey,
  setVercelGatewayApiKey,
} from "../../src/db";
import type {
  Feature,
  FeatureId,
  FeatureRun,
} from "../../src/features/Feature";
import {
  FEATURES,
  activeFeatures,
  featureIds,
  openFeatureTools,
} from "../../src/features/index";
import { FeatureId as WireFeatureId } from "../../src/gen/euler/v1/features_pb";
import { sandboxRunner } from "../../src/sandbox/SandboxRunner";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { waitForActivation } from "../helpers/activation";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** Makes the host-dependent requirements pass or fail the same on any machine. */
function hostCan(available: boolean) {
  spies.push(
    spyOn(sandboxRunner, "capability").mockResolvedValue(
      available
        ? { capable: true }
        : { capable: false, reason: "bubblewrap is not installed" },
    ),
  );
}

const feature = (id: FeatureId): Feature =>
  FEATURES.find((candidate) => candidate.id === id)!;

function run(
  ownerUuid: string,
  agentKind: FeatureRun["agentKind"],
  features: readonly Feature[] = FEATURES,
): FeatureRun {
  return {
    ownerUuid,
    agentKind,
    active: featureIds(features),
    signal: new AbortController().signal,
    host: agentRuntime.catalogHost(ownerUuid, agentKind),
  };
}

const activeIds = async (ownerUuid: string) =>
  featureIds(await activeFeatures(ownerUuid));

test("a feature is active only while its requirements are met and it is enabled", async () => {
  ensureUserData(TEST_USER_ID);
  hostCan(false);
  const unmet = await activeIds(TEST_USER_ID);
  for (const id of ["sandbox", "web", "imageGeneration", "mcp"] as const)
    expect(unmet.has(id)).toBe(false);
  expect(unmet.has("subagents")).toBe(true);
  expect(unmet.has("skills")).toBe(true);
  expect(await feature("sandbox").capable()).toEqual({
    capable: false,
    reason: "bubblewrap is not installed",
  });

  for (const spy of spies.splice(0)) spy.mockRestore();
  hostCan(true);
  setBraveSearchApiKey("brave-key");
  setVercelGatewayApiKey("vck-key");
  const met = await activeIds(TEST_USER_ID);
  for (const id of ["sandbox", "web", "imageGeneration"] as const)
    expect(met.has(id)).toBe(true);

  const { features } = rpc();
  await features.setFeatureEnabled({
    id: WireFeatureId.WEB,
    enabled: false,
  });
  expect((await activeIds(TEST_USER_ID)).has("web")).toBe(false);
  expect((await activeIds(OTHER_USER_ID)).has("web")).toBe(true);

  await features.setFeatureEnabled({
    id: WireFeatureId.IMAGE_GENERATION,
    enabled: false,
  });
  expect((await activeIds(TEST_USER_ID)).has("imageGeneration")).toBe(false);
  expect((await activeIds(OTHER_USER_ID)).has("imageGeneration")).toBe(true);
});

test("features report why they cannot run and only switchable ones can be set", async () => {
  hostCan(true);
  const { features } = rpc();
  const listed = (await features.listFeatures({})).features;
  const web = listed.find(({ id }) => id === WireFeatureId.WEB);
  expect(web).toMatchObject({
    label: "Web search",
    toggleable: true,
    enabled: true,
    unavailableReason: "Needs a Brave Search API key",
  });
  expect(
    listed.find(({ id }) => id === WireFeatureId.IMAGE_GENERATION),
  ).toMatchObject({
    label: "Image generation",
    toggleable: true,
    enabled: true,
    unavailableReason: "Needs an OpenRouter or Vercel AI Gateway API key",
  });
  // Only a feature with something to show draws a sidebar tab.
  expect(web?.sidebarTab).toBeUndefined();
  expect(
    listed.flatMap(({ sidebarTab }) => (sidebarTab ? [sidebarTab] : [])),
  ).toEqual(["Files", "Jobs", "Agents"]);
  // Files and Sandbox both let the user choose where the chat works.
  const commands = (id: WireFeatureId) =>
    listed
      .find((feature) => feature.id === id)
      ?.commands.map(({ name }) => name);
  expect(commands(WireFeatureId.SANDBOX)).toEqual([
    "directory",
    "link",
    "sandbox",
  ]);
  expect(commands(WireFeatureId.FILES)).toEqual([
    "directory",
    "link",
    "sandbox",
    "workspace",
  ]);
  expect(commands(WireFeatureId.WEB)).toEqual([]);
  expect(
    listed.find(({ id }) => id === WireFeatureId.SANDBOX)?.unavailableReason,
  ).toBeUndefined();
  expect(listed.find(({ id }) => id === WireFeatureId.MCP)?.toggleable).toBe(
    false,
  );
  expect(
    await rpcCode(
      features.setFeatureEnabled({ id: WireFeatureId.MCP, enabled: false }),
    ),
  ).toBe(Code.InvalidArgument);
});

test("each kind of agent gets its own tools, all named by the feature that adds them", async () => {
  ensureUserData(TEST_USER_ID);
  const names = async (kind: FeatureRun["agentKind"]) =>
    (await openFeatureTools(FEATURES, run(TEST_USER_ID, kind))).tools.map(
      (tool) => tool.name,
    );
  const main = await names("main");
  for (const tool of [
    "read_file",
    "bash",
    "get_job",
    "web_search",
    "generate_image",
    "load_skill",
    "manage_skills",
    "send_message",
    "spawn_agent",
  ])
    expect(main).toContain(tool);
  expect(main).not.toContain("ask_parent");
  const general = await names("general");
  expect(general).toContain("ask_parent");
  for (const tool of ["spawn_agent", "cancel_agent", "manage_skills"])
    expect(general).not.toContain(tool);

  // A tool missing from toolNames would keep working after its feature is switched off.
  for (const kind of ["main", "general"] as const)
    for (const candidate of FEATURES) {
      const { tools } = await candidate.tools(run(TEST_USER_ID, kind));
      for (const tool of tools)
        expect(candidate.toolNames).toContain(tool.name);
    }
});

test("skills reach only their owner's agents", async () => {
  ensureUserData(TEST_USER_ID);
  const skills = feature("skills");
  const mine = createSkillRow(TEST_USER_ID, {
    name: "feature-release-notes",
    description: "Write release notes.",
    instructions: "Release instructions only.",
    user_invocable: true,
    disable_model_invocation: false,
  });
  const theirs = createSkillRow(OTHER_USER_ID, {
    name: "feature-private-skill",
    description: "Private metadata.",
    instructions: "Private instructions.",
    user_invocable: true,
    disable_model_invocation: false,
  });
  const scope = run(TEST_USER_ID, "main");
  const prompt = skills.prompt(scope, "Use $feature-release-notes.");
  expect(prompt).toContain(mine.instructions);
  expect(prompt).not.toContain(theirs.description);
  const load = (await skills.tools(scope)).tools.find(
    (tool) => tool.name === "load_skill",
  )!;
  expect((await load.execute({ name: theirs.name })).text).toBe(
    `Error: skill '${theirs.name}' not found`,
  );
});

test("skills stay on with none saved, so the agent can write the first", async () => {
  const owner = "77777777-7777-4777-8777-777777777777";
  ensureUserData(owner);
  for (const skill of listSkills(owner)) deleteSkillRow(owner, skill.id);
  expect((await activeIds(owner)).has("skills")).toBe(true);
  const skills = feature("skills");
  const scope = run(owner, "main");
  expect((await skills.tools(scope)).tools.map((tool) => tool.name)).toEqual([
    "manage_skills",
  ]);
  expect(skills.prompt(scope, "Hello")).toBe("");

  await rpc(owner).features.setFeatureEnabled({
    id: WireFeatureId.SKILLS,
    enabled: false,
  });
  expect((await activeIds(owner)).has("skills")).toBe(false);
});

test("a chat runs with only a model provider", async () => {
  hostCan(false);
  setOpenRouterApiKey("sk-or-features-test");
  const { sessions, agent, features } = rpc();
  await features.setFeatureEnabled({
    id: WireFeatureId.FILES,
    enabled: false,
  });
  const { id } = await sessions.createSession({});
  try {
    await agent.sendMessage({
      sessionId: id,
      content: "Hello",
      settings: {
        metadata: { systemPrompt: "Be brief.\n{{SESSION_DIRECTORY}}" },
        model: "openrouter:openai/gpt-5.4-mini",
      },
    });
    const state = await waitForActivation(id);
    expect(state.agents[0]?.status).toBe("idle");
    const request = getOpenRouterRequests()[0]!.body as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
    expect(request.messages[0]?.content).not.toContain("Session directory");
    const tools = (request.tools ?? []).map((tool) => tool.function.name);
    for (const tool of ["read_file", "bash", "web_search"])
      expect(tools).not.toContain(tool);
    expect(tools).toContain("spawn_agent");
    // No workspace feature is active, so the chat never gets a directory.
    expect(existsSync(workspaceService.retainedPath(TEST_USER_ID, id))).toBe(
      false,
    );
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});
