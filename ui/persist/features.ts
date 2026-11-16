import type { Feature, FeatureId } from "../../src/gen/euler/v1/features_pb";
import { featureClient, withErrorMessage } from "../lib/rpc";

export type { Feature };

export async function fetchFeatures(): Promise<Feature[]> {
  return (
    await withErrorMessage(
      featureClient.listFeatures({}),
      "Failed to load features",
    )
  ).features;
}

export async function setFeatureEnabled(
  id: FeatureId,
  enabled: boolean,
): Promise<Feature[]> {
  return (
    await withErrorMessage(
      featureClient.setFeatureEnabled({ id, enabled }),
      "Failed to save feature",
    )
  ).features;
}
