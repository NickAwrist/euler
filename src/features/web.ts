import { getBraveSearchApiKey } from "../db/index";
import { FetchWebPageTool } from "../tools/fetch_web_page";
import { WebSearchTool } from "../tools/web_search";
import {
  CAPABLE,
  type Capability,
  type FeatureTools,
  ToggleFeature,
} from "./Feature";

export class WebFeature extends ToggleFeature {
  readonly id = "web";
  readonly label = "Web search";
  readonly description = "Search the web and read web pages.";
  readonly toolNames = ["web_search", "fetch_web_page"];

  async capable(): Promise<Capability> {
    return getBraveSearchApiKey()
      ? CAPABLE
      : { capable: false, reason: "Needs a Brave Search API key" };
  }

  override async tools(): Promise<FeatureTools> {
    return { tools: [new WebSearchTool(), new FetchWebPageTool()] };
  }
}
