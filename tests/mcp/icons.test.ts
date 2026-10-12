import { expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Icon } from "@modelcontextprotocol/sdk/types.js";
import { safeMcpIcons } from "../../src/mcp/icons";
import { McpTool } from "../../src/tools/mcp";

test("MCP icons allow same-origin HTTPS and bounded raster data only", () => {
  const allowed = [
    { src: "https://mcp.example/icon.png" },
    { src: "data:image/png;base64,AAAA" },
  ];
  expect(
    safeMcpIcons(
      [
        ...allowed,
        { src: "https://tracker.example/icon.png" },
        { src: "http://mcp.example/icon.png" },
        { src: "https://user:password@mcp.example/icon.png" },
        { src: "javascript:alert(1)" },
        { src: "data:image/svg+xml;base64,AAAA" },
        { src: `data:image/png;base64,${"A".repeat(256 * 1024)}` },
      ],
      "https://mcp.example/tools",
    ),
  ).toEqual(allowed);
});

test("a tool icon takes precedence, with safe server icons as fallback", () => {
  const client = new Client({ name: "test", version: "1" });
  const serverIcons = [{ src: "https://mcp.example/server.png" }];
  const version = spyOn(client, "getServerVersion").mockReturnValue({
    name: "test",
    version: "1",
    icons: serverIcons,
  });
  try {
    const create = (icons?: Icon[]) =>
      new McpTool(
        client,
        "test",
        {
          name: "echo",
          inputSchema: { type: "object" },
          icons,
        },
        "https://mcp.example/tools",
      );
    expect(create().icons).toEqual(serverIcons);
    const toolIcons = [{ src: "https://mcp.example/tool.png" }];
    expect(create(toolIcons).icons).toEqual(toolIcons);
    expect(create([{ src: "https://tracker.example/icon.png" }]).icons).toEqual(
      serverIcons,
    );
  } finally {
    version.mockRestore();
  }
});
