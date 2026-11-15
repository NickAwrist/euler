import { getComfyUIClient } from "../comfyui/client";
import { GenerateImageTool } from "../tools/generate_image";
import {
  CAPABLE,
  type Capability,
  type FeatureTools,
  ToggleFeature,
} from "./Feature";

/** Runs before every turn, so an unreachable host must not hold the turn up. */
const HEALTH_TIMEOUT_MS = 2000;

export class ImageGenerationFeature extends ToggleFeature {
  readonly id = "imageGeneration";
  readonly label = "Image generation";
  readonly description = "Generate images with ComfyUI.";
  readonly toolNames = ["generate_image"];

  async capable(): Promise<Capability> {
    const health = await getComfyUIClient().healthCheck(HEALTH_TIMEOUT_MS);
    return health.ok
      ? CAPABLE
      : { capable: false, reason: "ComfyUI is not reachable" };
  }

  override async tools(): Promise<FeatureTools> {
    return { tools: [new GenerateImageTool()] };
  }
}
