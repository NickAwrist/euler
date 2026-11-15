import type { FeatureId } from "../../src/features/Feature";
import { FEATURES, featureIds } from "../../src/features/index";

/** Every feature but the given ones, as a run's permissions take them. */
export function featuresExcept(...off: FeatureId[]): Set<FeatureId> {
  return featureIds(FEATURES.filter((feature) => !off.includes(feature.id)));
}
