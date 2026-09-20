import type { DirectoryEntry } from "../../src/schemas/artifacts";
import type { ArtifactSource } from "../components/Artifacts/api";
import type { Message } from "../types";

const files: Record<string, string> = {
  "docs/readme.md":
    "# Workspace notes\n\nA preview with **formatted text**.\n\n## Release checklist\n\n- [x] Add workspace browsing\n- [x] Render Markdown\n- [ ] Review file previews\n\n## Service settings\n\n| Setting | Value |\n| --- | --- |\n| Port | 8080 |\n| Health check | /health |\n\n```sh\ncurl http://localhost:8080/health\n```\n\n> Use the source icon to inspect the original Markdown.",
  "docs/architecture.md":
    "# Service architecture\n\nThe API accepts jobs and writes them to a queue. Workers claim pending jobs and record results.\n\n## Failure handling\n\nRetry transient errors up to three times. Keep failed jobs available for inspection.\n\n## Open questions\n\n1. How long should completed jobs be retained?\n2. Should retries use exponential backoff?",
  "src/server.ts":
    'import { serve } from "bun";\n\nserve({\n  port: 8080,\n  fetch(request) {\n    const url = new URL(request.url);\n    if (url.pathname === "/health") {\n      return Response.json({ status: "ok" });\n    }\n    return new Response("Not found", { status: 404 });\n  },\n});\n',
  "data/results.csv":
    "endpoint,requests,p95_ms,error_rate\n/health,10000,4,0\n/jobs,2500,82,0.002\n/jobs/123,8000,18,0\n",
  "package.json":
    '{\n  "name": "queue-service",\n  "private": true,\n  "scripts": { "start": "bun src/server.ts" }\n}\n',
  "empty.txt": "",
  "logs/run.txt":
    "[09:40:00] Starting checks\n[09:40:01] Health endpoint passed\n[09:40:02] Queue connection passed\n[09:40:03] All checks complete\n",
};
const alternateFiles: Record<string, string> = {
  "notes.md":
    "# Second workspace\n\nThis directory has its own files. The previous selection and expanded folders have been cleared.",
  "config.json": '{ "environment": "staging", "workers": 2 }',
};

export function fixtureSource(alternate: boolean): ArtifactSource {
  const contents = alternate ? alternateFiles : files;
  const paths = [
    ...Object.keys(contents),
    ...(alternate ? [] : ["empty/", "assets/latency.svg", "large.txt"]),
  ];
  return {
    download: async (path, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      signal.throwIfAborted();
      if (!alternate && path === "large.txt")
        return new Blob(["a".repeat(1024 * 1024 + 1)], { type: "text/plain" });
      const preview = await fixtureSource(alternate).preview(path, signal);
      return preview.kind === "text"
        ? new Blob([preview.content], { type: "text/plain" })
        : new Blob(
            [
              Uint8Array.from(atob(preview.data), (character) =>
                character.charCodeAt(0),
              ),
            ],
            { type: preview.mediaType },
          );
    },
    list: async (path, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      signal.throwIfAborted();
      const prefix = path === "." ? "" : `${path}/`;
      const entries = new Map<string, DirectoryEntry>();
      for (const file of paths) {
        if (!file.startsWith(prefix)) continue;
        const suffix = file.slice(prefix.length);
        const name = suffix.split("/")[0];
        if (name)
          entries.set(name, {
            name,
            path: `${prefix}${name}`,
            kind: suffix.includes("/") ? "directory" : "file",
          });
      }
      return [...entries.values()].sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "directory"
            ? -1
            : 1,
      );
    },
    preview: async (path, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      signal.throwIfAborted();
      if (!alternate && path === "assets/latency.svg")
        return {
          kind: "image",
          path,
          mediaType: "image/svg+xml",
          data: btoa(
            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" rx="12" fill="#20242c"/><g font-family="system-ui,sans-serif" fill="#e6e8ef"><text x="40" y="55" font-size="24" font-weight="600">API response times</text><text x="40" y="85" font-size="14" fill="#a0aabb">95th percentile, milliseconds</text><text x="40" y="153" font-size="15">/health</text><text x="40" y="223" font-size="15">/jobs</text><text x="40" y="293" font-size="15">/jobs/123</text><rect x="155" y="128" width="20" height="36" rx="4" fill="#69a8ff"/><rect x="155" y="198" width="328" height="36" rx="4" fill="#69a8ff"/><rect x="155" y="268" width="72" height="36" rx="4" fill="#69a8ff"/><text x="187" y="153" font-size="16">4 ms</text><text x="495" y="223" font-size="16">82 ms</text><text x="239" y="293" font-size="16">18 ms</text><text x="40" y="365" font-size="13" fill="#a0aabb">Queue service / sample benchmark</text></g></svg>`,
          ),
        };

      if (path === "large.txt")
        throw new Error("Preview is limited to files up to 1 MB");
      const content = contents[path];
      if (content === undefined) throw new Error("File no longer exists");
      return { kind: "text", path, content };
    },
  };
}

export function fixtureMessages(alternate: boolean): Message[] {
  return alternate
    ? [
        { role: "user", content: "What is in this directory?" },
        {
          role: "assistant",
          content:
            "This is a separate workspace. Open [the directory notes](notes.md) or inspect [config.json](config.json). Switch back with Change directory to return to the service example.",
        },
      ]
    : [
        {
          role: "user",
          content:
            "Put together a small queue service example with documentation and sample results.",
        },
        {
          role: "assistant",
          attachments: [
            {
              id: "30a14710-74b8-4aa0-aa40-90e9b5ac606e",
              kind: "file",
              name: "readme.md",
              path: "docs/readme.md",
              size: files["docs/readme.md"]!.length,
              sessionId: "demo",
              workspaceKind: "sandbox",
              temporary: false,
            },
          ],
          content:
            "I've prepared the workspace. Start with [the notes](docs/readme.md), which include a checklist, a settings table, and a shell command.\n\nThe implementation is in [src/server.ts](src/server.ts), and [package.json](package.json) contains the start command. Read [the architecture](docs/architecture.md) for the queue and retry design.",
        },
        {
          role: "user",
          content: "Show me the results and anything else worth checking.",
        },
        {
          role: "assistant",
          content:
            "Open [the sample results](data/results.csv) or [the run log](/workspace/logs/run.txt). These use the plain text preview.\n\nYou can also test these states:\n\n- [empty.txt](empty.txt) is an empty file.\n- [assets/latency.svg](assets/latency.svg) previews the latency chart.\n- [large.txt](large.txt) shows the preview size limit.\n- [missing.md](missing.md) shows a missing-file error.\n\nUse the sidebar icon to browse the folders. **Change directory** switches to a different mock workspace.",
        },
      ];
}
