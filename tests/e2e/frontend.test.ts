import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("serves direct run URLs from a hidden deployment directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "agents-frontend-"));
  const cwd = join(root, ".deployment");
  const dist = join(cwd, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>Agents</title>",
  );
  writeFileSync(join(dist, "app.js"), "console.log('agents');");

  try {
    // Use a fresh process so app initialization uses the fixture's cwd and env.
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          import assert from "node:assert/strict";
          import { app } from ${JSON.stringify(new URL("../../src/app.ts", import.meta.url).pathname)};
          const server = app.listen(0, "127.0.0.1");
          await new Promise(resolve => server.once("listening", resolve));
          const base = "http://127.0.0.1:" + server.address().port;
          try {
            for (const path of ["/", "/run/aeb31153-6ca7-46ac-8547-e71ccb4cfb07"]) {
              const response = await fetch(base + path);
              assert.equal(response.status, 200, path);
              assert.ok(response.headers.get("content-type").includes("text/html"));
              assert.equal(await response.text(), "<!doctype html><title>Agents</title>");
            }
            const asset = await fetch(base + "/app.js");
            assert.equal(asset.status, 200);
            assert.equal(await asset.text(), "console.log('agents');");
            const api = await fetch(base + "/api/missing");
            assert.equal(api.status, 404);
            assert.equal((await api.json()).error.code, "NOT_FOUND");
          } finally {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          }
        `,
      ],
      {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: "production",
          LOG_LEVEL: "silent",
          EULER_SERVE_FRONTEND: "true",
          EULER_DB_PATH: ":memory:",
          EULER_DATA_ROOT: join(root, "data"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
