import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  outputDir: ".cache/browser-results",
  use: {
    baseURL: "http://127.0.0.1:5199",
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    launchOptions: { channel: "chromium" },
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      grep: /environment settings mobile|usage mobile|chat sidebar mobile|artifacts mobile|mobile message actions and code layout$|sheet dismissal, busy actions, and retry confirmation$|composer selectors mobile|model preferences mobile/,
      use: {
        // Keep touch media queries stable while Chromium captures screenshots.
        launchOptions: {
          channel: "chromium",
          args: [
            "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=0,availableHoverTypes=0",
          ],
        },
      },
    },
    {
      name: "desktop",
      grep: /model defaults desktop|view navigation desktop|markdown rendering|environment settings desktop|usage desktop|chat sidebar desktop|artifacts desktop|long thread|desktop hover|attachment image loading|session loading|composer selectors desktop|model preferences desktop|modal desktop|system prompt settings desktop/,
    },
  ],
  webServer: {
    command: "bun run dev:ui --port 5199 --strictPort",
    url: "http://127.0.0.1:5199/dev/messages",
    reuseExistingServer: !process.env.CI,
  },
});
