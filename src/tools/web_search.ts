import type { Tool } from "ollama";
import { getSearXNGClient } from "../searxng/client";
import { errorMessage } from "../utils/errors";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

export class WebSearchTool extends BaseTool {
  constructor() {
    super(
      "web_search",
      "Search the web using the configured local SearXNG server.",
    );
  }

  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "The search query string." },
            max_results: {
              type: "number",
              description: "Maximum results to return (default 5, max 10).",
            },
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      return textToolResult("Error: query must be a non-empty string");
    }

    const maxResults =
      typeof args.max_results === "number"
        ? Math.min(Math.max(1, args.max_results), 10)
        : 5;

    try {
      const results = await getSearXNGClient().search(args.query, maxResults);

      if (results.length === 0) {
        return textToolResult("No results found.");
      }

      return textToolResult(
        results
          .map((r, i) => {
            const parts = [`Result ${i + 1} (${r.title}):`];
            if (r.url) parts.push(r.url);
            if (r.engine) parts.push(`Source: ${r.engine}`);
            parts.push(r.content);
            return parts.join("\n");
          })
          .join("\n\n---\n\n"),
      );
    } catch (e: unknown) {
      return textToolResult(`Error performing web search: ${errorMessage(e)}`);
    }
  }
}
