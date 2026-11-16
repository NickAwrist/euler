import type {
  Capability,
  Feature,
  FeatureId,
  FeatureRun,
  FeatureTools,
} from "./Feature";
import { FilesFeature } from "./files";
import { ImageGenerationFeature } from "./imageGeneration";
import { McpFeature } from "./mcp";
import { SandboxFeature } from "./sandbox";
import { SkillsFeature } from "./skills";
import { SubagentsFeature } from "./subagents";
import { WebFeature } from "./web";

export const FEATURES: readonly Feature[] = [
  new FilesFeature(),
  new SandboxFeature(),
  new WebFeature(),
  new ImageGenerationFeature(),
  new SkillsFeature(),
  new SubagentsFeature(),
  new McpFeature(),
];

type FeatureStatus = {
  feature: Feature;
  enabled: boolean;
  capability: Capability;
};

export function featureStatuses(ownerUuid: string): Promise<FeatureStatus[]> {
  return Promise.all(
    FEATURES.map(async (feature) => ({
      feature,
      enabled: feature.enabled(ownerUuid),
      capability: await feature.capable(),
    })),
  );
}

/** The features that are both enabled and capable, which is what a run gets. */
export async function activeFeatures(ownerUuid: string): Promise<Feature[]> {
  // A switched-off feature is not checked, so its check cannot slow the turn.
  const enabled = FEATURES.filter((feature) => feature.enabled(ownerUuid));
  const capabilities = await Promise.all(
    enabled.map((feature) => feature.capable()),
  );
  return enabled.filter((_, index) => capabilities[index]?.capable);
}

export function featureIds(features: readonly Feature[]): Set<FeatureId> {
  return new Set(features.map((feature) => feature.id));
}

export function featureOwning(toolName: string): Feature | undefined {
  return FEATURES.find((feature) => feature.toolNames.includes(toolName));
}

export async function openFeatureTools(
  features: readonly Feature[],
  run: FeatureRun,
): Promise<FeatureTools> {
  const sets = await Promise.all(features.map((feature) => feature.tools(run)));
  return {
    tools: sets.flatMap((set) => set.tools),
    close: async () => {
      await Promise.all(sets.map((set) => set.close?.()));
    },
  };
}
