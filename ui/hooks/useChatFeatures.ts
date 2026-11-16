import { FeatureId } from "../../src/gen/euler/v1/features_pb";
import { type RunCommand, featureRunCommands } from "../components/runCommands";
import { useFeatures } from "./useFeatures";

export type SidebarView = "files" | "jobs" | "agents";

/** The sidebar view each feature draws. A feature with no entry has no tab. */
const SIDEBAR_VIEWS: Partial<Record<FeatureId, SidebarView>> = {
  [FeatureId.FILES]: "files",
  [FeatureId.SANDBOX]: "jobs",
  [FeatureId.SUBAGENTS]: "agents",
};

/**
 * What the running features add to a chat: a sidebar tab for each that draws
 * one, their composer commands, and "$" skills. All are off until the features
 * load.
 * A hook, so React Compiler treats the lists as read-only.
 */
export function useChatFeatures(): {
  sidebarTabs: { value: SidebarView; label: string }[];
  commands: RunCommand[];
  skills: boolean;
} {
  const { features } = useFeatures();
  const running = (features ?? []).filter(
    (feature) => feature.enabled && feature.unavailableReason === undefined,
  );
  return {
    sidebarTabs: running.flatMap((feature) => {
      const view = SIDEBAR_VIEWS[feature.id];
      return view && feature.sidebarTab !== undefined
        ? [{ value: view, label: feature.sidebarTab }]
        : [];
    }),
    commands: featureRunCommands(running),
    skills: running.some((feature) => feature.id === FeatureId.SKILLS),
  };
}
