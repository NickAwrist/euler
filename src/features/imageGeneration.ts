import { configuredImageProviders } from "../imageGen/index";
import { GenerateImageTool } from "../tools/generate_image";
import {
  CAPABLE,
  type Capability,
  type FeatureTools,
  ToggleFeature,
} from "./Feature";

export class ImageGenerationFeature extends ToggleFeature {
  readonly id = "imageGeneration";
  readonly label = "Image generation";
  readonly description =
    "Generate images with OpenRouter or Vercel AI Gateway.";
  readonly toolNames = ["generate_image"];

  override async capable(): Promise<Capability> {
    return configuredImageProviders().length > 0
      ? CAPABLE
      : {
          capable: false,
          reason: "Needs an OpenRouter or Vercel AI Gateway API key",
        };
  }

  override async tools(): Promise<FeatureTools> {
    return { tools: [new GenerateImageTool()] };
  }
}
