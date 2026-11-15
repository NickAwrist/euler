#!/usr/bin/env bun
/**
 * Generates ios/Euler.xcodeproj with XcodeGen. ios/project.yml takes the Apple
 * team and the bundle ID prefix from the environment, and XcodeGen leaves an
 * unset name in place as text, so this checks both first. Set them in .env:
 *
 *   bun run ios:project
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const missing = ["EULER_IOS_TEAM_ID", "EULER_IOS_BUNDLE_PREFIX"].filter(
  (name) => !process.env[name]?.trim(),
);
if (missing.length > 0) {
  console.error(`Set ${missing.join(" and ")} in .env. See .env.example.`);
  process.exit(1);
}

const result = spawnSync("xcodegen", ["generate"], {
  cwd: join(import.meta.dir, "../ios"),
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
