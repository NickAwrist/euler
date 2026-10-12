import { expect, test } from "bun:test";
import { createSessionRow, patchSessionRow } from "../../src/db/sessions";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../../src/db/userPreferences";
import { permissionService } from "../../src/permissions/PermissionService";
import { ToolApprovalCoordinator } from "../../src/permissions/ToolApprovalCoordinator";
import { removeToolPermissionRule } from "../../src/permissions/preferences";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { allToolsRule } from "../helpers/toolPermissions";

async function fixture() {
  const owner = "11111111-1111-4111-8111-111111111111";
  const id = crypto.randomUUID();
  createSessionRow(owner, id, Date.now(), "test");
  const workspace = await workspaceService.provisionRetained(owner, id);
  const controller = new AbortController();
  updateUserPreferences(owner, {
    toolPermissions: { rules: [allToolsRule()] },
  });
  const coordinator = new ToolApprovalCoordinator(() => {});
  const context = {
    owner,
    sessionId: id,
    agentId: "agent",
    agentTitle: "Main",
    workspace,
    signal: controller.signal,
    waiting: () => {},
  };
  return { owner, id, coordinator, context, controller };
}
test("allow matching saves narrow rules, duplicate/foreign responses cannot grant access, Undo removes the grant", async () => {
  const { owner, id, coordinator, context } = await fixture();
  const args = { command: "npm publish", background: false };
  const pending = coordinator.authorize(context, "bash", args);
  const approval = coordinator.list(owner, id)[0]!;
  await expect(
    coordinator.respond("another-owner", id, approval.id, {
      decision: "allow_once",
    }),
  ).rejects.toThrow("not found");
  const saved = await coordinator.respond(owner, id, approval.id, {
    decision: "allow_matching",
  });
  await pending;
  expect(saved.rule?.condition).toEqual({ kind: "arguments", value: args });
  expect(saved.rule?.sessionId).toBe(id);
  expect(coordinator.list(owner, id)).toEqual([]);
  await expect(
    coordinator.respond(owner, id, approval.id, { decision: "allow_once" }),
  ).rejects.toThrow();
  const prefs = effectiveUserPreferences(owner);
  const policy = permissionService.resolve(
    context.workspace,
    prefs.capabilities,
    prefs.toolPermissions,
  );
  expect(
    permissionService.callDecision(policy, "bash", args, {
      sessionId: id,
      workspacePath: context.workspace.hostPath,
    }).action,
  ).toBe("allow");
  await coordinator.authorize(context, "bash", args);
  removeToolPermissionRule(owner, saved.rule!.id);
  expect(effectiveUserPreferences(owner).toolPermissions.rules).toEqual([
    allToolsRule(),
  ]);
});
test("allow once does not save a rule and denying returns an error to the agent", async () => {
  const { owner, id, coordinator, context } = await fixture();
  let pending = coordinator.authorize(context, "bash", { command: "build" });
  await coordinator.respond(owner, id, coordinator.list(owner, id)[0]!.id, {
    decision: "allow_once",
  });
  await pending;
  expect(effectiveUserPreferences(owner).toolPermissions.rules).toEqual([
    allToolsRule(),
  ]);
  pending = coordinator.authorize(context, "bash", { command: "build" });
  void pending.catch(() => {});
  await coordinator.respond(owner, id, coordinator.list(owner, id)[0]!.id, {
    decision: "deny",
  });
  await expect(pending).rejects.toThrow("denied by the user");
});
test("cancellation removes pending requests and cannot persist a matching grant", async () => {
  const { owner, id, coordinator, context, controller } = await fixture();
  const pending = coordinator.authorize(context, "bash", { command: "build" });
  const approval = coordinator.list(owner, id)[0]!;
  void pending.catch(() => {});
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  await expect(
    coordinator.respond(owner, id, approval.id, { decision: "allow_matching" }),
  ).rejects.toThrow();
  expect(coordinator.list(owner, id)).toEqual([]);
  expect(effectiveUserPreferences(owner).toolPermissions.rules).toEqual([
    allToolsRule(),
  ]);
});
test("capabilities and workspace are rechecked while a user is considering approval", async () => {
  const { owner, id, coordinator, context, controller } = await fixture();
  const pending = coordinator.authorize(context, "bash", { command: "build" });
  void pending.catch(() => {});
  const approval = coordinator.list(owner, id)[0]!;
  updateUserPreferences(owner, { capabilities: { shell: false } });
  await expect(
    coordinator.respond(owner, id, approval.id, { decision: "allow_matching" }),
  ).rejects.toThrow("disabled");
  expect(effectiveUserPreferences(owner).toolPermissions.rules).toEqual([
    allToolsRule(),
  ]);
  updateUserPreferences(owner, { capabilities: { shell: true } });
  patchSessionRow(owner, id, {
    workspace_kind: "local",
    session_directory: "/tmp",
  });
  await expect(
    coordinator.respond(owner, id, approval.id, { decision: "allow_once" }),
  ).rejects.toThrow("working directory changed");
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
});

test("approval requests retain tool icon metadata", async () => {
  const { owner, id, coordinator, context } = await fixture();
  const icons = [{ src: "data:image/png;base64,AAAA" }];
  const pending = coordinator.authorize(
    { ...context, icons },
    "mcp__test__echo",
    { text: "hello" },
  );
  const approval = coordinator.list(owner, id)[0]!;
  expect(approval.icons).toEqual(icons);
  await coordinator.respond(owner, id, approval.id, { decision: "allow_once" });
  await pending;
});
