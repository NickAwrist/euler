import type { AgentRecord } from "../db/agents";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import type { Job } from "../schemas/jobs";
import type { FeatureToggles } from "../schemas/userPreferences";
import type { BaseTool } from "../tools/BaseTool";
import type { AgentMessageRequest } from "../tools/send_message";
import type { SpawnRequest, SpawnResult } from "../tools/spawn_agent";

export type FeatureId = keyof FeatureToggles | "skills" | "mcp";

export type Capability = { capable: true } | { capable: false; reason: string };

export const CAPABLE: Capability = { capable: true };

/** Runtime operations behind the tools that act on a chat's agents and jobs. */
export type RunHost = {
  readJob(id: string): Job;
  cancelJob(id: string): Promise<Job>;
  sendMessage(request: AgentMessageRequest): void;
  askParent(question: string): void;
  spawn(request: SpawnRequest): Promise<SpawnResult>;
  cancelAgent(agentId: string, reason: string): Promise<void>;
};

/** The agent a feature contributes to, and the features active beside it. */
export type FeatureScope = {
  ownerUuid: string;
  agentKind: AgentRecord["kind"];
  active: ReadonlySet<FeatureId>;
};

export type FeatureRun = FeatureScope & { signal: AbortSignal; host: RunHost };

/** A "/" command the composer offers. The client runs it by name. */
export type FeatureCommand = { name: string; description: string };

export type FeatureTools = { tools: BaseTool[]; close?(): Promise<void> };

/**
 * A part of the app with its own requirements. An agent gets a feature's tools
 * and prompt text only while the feature is capable and enabled.
 */
export abstract class Feature {
  abstract readonly id: FeatureId;
  abstract readonly label: string;
  abstract readonly description: string;
  /** Every tool the feature can add, so a call is refused once it is off. */
  abstract readonly toolNames: readonly string[];
  /** Whether its tools work in the chat's workspace directory. */
  readonly usesWorkspace: boolean = false;
  /** The label of its tab in a chat's sidebar, which shows what it produces. */
  readonly sidebarTab?: string;
  readonly commands: readonly FeatureCommand[] = [];

  /** Checks the requirements the user's choice cannot change. */
  abstract capable(): Promise<Capability>;
  abstract enabled(ownerUuid: string): boolean;

  async tools(_run: FeatureRun): Promise<FeatureTools> {
    return { tools: [] };
  }

  /** Text for the system prompt; empty adds nothing. */
  prompt(_scope: FeatureScope, _userPrompt: string): string {
    return "";
  }
}

/** A feature the user switches on and off in settings. */
export abstract class ToggleFeature extends Feature {
  abstract override readonly id: keyof FeatureToggles;

  enabled(ownerUuid: string): boolean {
    return effectiveUserPreferences(ownerUuid).features[this.id];
  }

  setEnabled(ownerUuid: string, enabled: boolean): void {
    updateUserPreferences(ownerUuid, { features: { [this.id]: enabled } });
  }
}

/** Where the chat works, which every workspace feature lets the user choose. */
export const WORKSPACE_COMMANDS: readonly FeatureCommand[] = [
  {
    name: "directory",
    description: "Allow this chat to work in a folder on the server",
  },
  { name: "link", description: "Work in another chat's workspace" },
  { name: "sandbox", description: "Return this chat to its private workspace" },
];

/** A feature whose tools work in the chat's workspace directory. */
export abstract class WorkspaceFeature extends ToggleFeature {
  override readonly usesWorkspace = true;
  override readonly commands: readonly FeatureCommand[] = WORKSPACE_COMMANDS;
}
