import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.pw.ts",
  outputDir: "../../.cache/design-mock-results",
  use: {
    baseURL: "http://127.0.0.1:5203",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "chromium" },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev:ui --port 5203 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:5203/dev/experimental/browser-use",
    reuseExistingServer: !process.env.CI,
  },
});
