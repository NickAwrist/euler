#!/usr/bin/env bun
/**
 * Copies the web's provider logos (public/icons) into the iOS asset catalog,
 * rewritten for CoreSVG: numeric sizes, no currentColor, gradients defined
 * before use, and arc flags spelled out. Also draws the thinking-level brains
 * from the web's paths (ui/components/ThinkingLevelBar.tsx). Run after
 * changing either:
 *
 *   bun run ios:icons
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAIN_CENTER_FISSURE_PATH,
  BRAIN_INNER_FOLD_PATHS,
  BRAIN_OUTER_LOBE_PATHS,
} from "../ui/components/ThinkingLevelBar";

const root = join(import.meta.dir, "..");
const assets = join(root, "ios/Euler/Assets.xcassets");

// Monochrome logos are templates the app tints, as the web inverts them.
const icons: { name: string; source: string; template: boolean }[] = [
  ...["claude", "deepseek", "gemini", "meta", "mistral", "qwen"].map(
    (name) => ({
      name,
      source: `public/icons/providers/${name}.svg`,
      template: false,
    }),
  ),
  ...["codex", "openai", "xai", "moonshot"].map((name) => ({
    name,
    source: `public/icons/providers/${name}.svg`,
    template: true,
  })),
  { name: "ollama", source: "public/icons/ollama.svg", template: true },
];

const argumentCounts: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};
const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Rewrites path data with every argument separated, so "0 01-4.45" reads as flags 0, 1. */
function spellOutPath(data: string): string {
  const out: string[] = [];
  let command = "";
  let index = 0;
  const skip = () => {
    while (index < data.length && " ,\n\t".includes(data[index]!)) index++;
  };
  while (index < data.length) {
    skip();
    if (index >= data.length) break;
    const char = data[index]!;
    if (/[a-zA-Z]/.test(char)) {
      command = char;
      out.push(char);
      index++;
      continue;
    }
    const count = argumentCounts[command.toLowerCase()];
    if (!count) throw new Error(`Unexpected "${char}" after "${command}"`);
    const args: string[] = [];
    for (let k = 0; k < count; k++) {
      skip();
      if (command.toLowerCase() === "a" && (k === 3 || k === 4)) {
        args.push(data[index++]!);
        continue;
      }
      number.lastIndex = index;
      const match = number.exec(data);
      if (!match)
        throw new Error(`Expected a number at ${index} in ${command}`);
      args.push(match[0]);
      index = number.lastIndex;
    }
    out.push(`${args.join(" ")} `);
  }
  return out.join("").trim();
}

function forCoreSvg(svg: string): string {
  let result = svg
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .replace(/<title>[^<]*<\/title>/g, "")
    .replace(/ style="[^"]*"/g, "")
    .replace(/ width="1em"/, ' width="24"')
    .replace(/ height="1em"/, ' height="24"')
    .replaceAll("currentColor", "#000000")
    .replace(
      / d="([^"]*)"/g,
      (_, data: string) => ` d="${spellOutPath(data)}"`,
    );
  const defs = result.match(/<defs>[\s\S]*<\/defs>/)?.[0];
  if (defs) {
    result = result.replace(defs, "");
    const open = result.indexOf(">", result.indexOf("<svg")) + 1;
    result = result.slice(0, open) + defs + result.slice(open);
  }
  return result;
}

/** Replaces a folder of the catalog with one image set per SVG. */
function writeFolder(
  folder: string,
  images: { name: string; svg: string; template: boolean }[],
) {
  const dir = join(assets, folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "Contents.json"), {
    info: { author: "xcode", version: 1 },
  });
  for (const image of images) {
    const set = join(dir, `${image.name}.imageset`);
    mkdirSync(set);
    writeFileSync(join(set, `${image.name}.svg`), image.svg);
    writeJson(join(set, "Contents.json"), {
      images: [{ filename: `${image.name}.svg`, idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: {
        ...(image.template ? { "template-rendering-intent": "template" } : {}),
        "preserves-vector-representation": true,
      },
    });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The web's BrainTierIcon for each tier the app shows. */
function brain(tier: "off" | "low" | "medium" | "high"): string {
  const lobes = BRAIN_OUTER_LOBE_PATHS.map((path) => `<path d="${path.d}"/>`);
  const fissure = `<path d="${BRAIN_CENTER_FISSURE_PATH}"/>`;
  const folds = BRAIN_INNER_FOLD_PATHS.map((path) => `<path d="${path.d}"/>`);
  const parts = {
    off: [...lobes, '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/>'],
    low: lobes,
    medium: [fissure, ...lobes],
    high: [fissure, ...folds, ...lobes],
  }[tier];
  return forCoreSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</svg>`,
  );
}

writeFolder(
  "Providers",
  icons.map((icon) => ({
    name: `provider-${icon.name}`,
    svg: forCoreSvg(readFileSync(join(root, icon.source), "utf8")),
    template: icon.template,
  })),
);
writeFolder(
  "Thinking",
  (["off", "low", "medium", "high"] as const).map((tier) => ({
    name: `brain-${tier}`,
    svg: brain(tier),
    template: true,
  })),
);
console.log(`Wrote ${icons.length} provider icons and 4 brains to ${assets}`);
