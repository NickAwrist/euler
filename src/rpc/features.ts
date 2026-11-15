import type { ServiceImpl } from "@connectrpc/connect";
import {
  type FeatureId as DomainFeatureId,
  ToggleFeature,
} from "../features/Feature";
import { FEATURES, featureStatuses } from "../features/index";
import { FeatureId, type FeatureService } from "../gen/euler/v1/features_pb";
import { OperationError } from "../observability/errors";
import { choices } from "../preferences/wire";
import { ownerOf } from "./context";

const featureIds = choices<DomainFeatureId, FeatureId>({
  files: FeatureId.FILES,
  sandbox: FeatureId.SANDBOX,
  web: FeatureId.WEB,
  imageGeneration: FeatureId.IMAGE_GENERATION,
  skills: FeatureId.SKILLS,
  subagents: FeatureId.SUBAGENTS,
  mcp: FeatureId.MCP,
});

async function features(owner: string) {
  return {
    features: (await featureStatuses(owner)).map(
      ({ feature, enabled, capability }) => ({
        id: featureIds.toProto(feature.id),
        label: feature.label,
        description: feature.description,
        toggleable: feature instanceof ToggleFeature,
        enabled,
        unavailableReason: capability.capable ? undefined : capability.reason,
        sidebarTab: feature.sidebarTab,
        commands: [...feature.commands],
      }),
    ),
  };
}

export const featureService: ServiceImpl<typeof FeatureService> = {
  listFeatures(_request, context) {
    return features(ownerOf(context));
  },
  setFeatureEnabled(request, context) {
    const owner = ownerOf(context);
    const id = featureIds.fromProto(request.id);
    const feature = FEATURES.find((candidate) => candidate.id === id);
    if (!(feature instanceof ToggleFeature))
      throw new OperationError("INVALID_REQUEST", {
        message: "This feature has no switch",
      });
    feature.setEnabled(owner, request.enabled);
    return features(owner);
  },
};
