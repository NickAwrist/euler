import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE_PATH = fileURLToPath(
  new URL("./baseline.json", import.meta.url),
);
const OUTPUT = "/tmp/euler-performance-check";
const PORT = 5305;
const WORKLOAD = { sessions: 100, longSessionMessages: 200 };
// Four local count runs with smaller jumps had no repeated row mounts.
// Large-jump timings retain the original traversal.
const COUNT_SCROLL_STEPS = 200;
const TIMING_SCROLL_STEPS = 40;
const TYPED_TEXT =
  "<prompt>A mountain lake at sunrise</prompt> <prompt>A cabin in the snow</prompt>";
const STREAM_CHUNKS = 50;
const COMPOSER = "Send a message...";
const TIMING_RUNS = 3;
// Roughly a mid-range phone; applies to the reported timings only.
const TIMING_CPU_SLOWDOWN = 4;

const update = process.argv.includes("--update");

/**
 * Starts the fixture (production bundle, real API and SQLite, fake Ollama
 * driven through a loopback control port) in a fresh temporary workspace.
 */
async function startFixture() {
  const server = spawn("bun", [join(ROOT, "scripts/performance/fixture.ts")], {
    cwd: ROOT,
    env: { LOG_LEVEL: "error", ...process.env, PERF_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  // A crash that skips stop() must not leave the server holding its port.
  process.once("exit", () => server.kill("SIGTERM"));
  const lines = createInterface({ input: server.stdout });
  const identity = await new Promise((resolve, reject) => {
    server.once("exit", (code) =>
      reject(new Error(`Fixture server exited with code ${code}`)),
    );
    lines.on("line", (line) => {
      const record = JSON.parse(line);
      if ("controlPort" in record) resolve(record);
    });
  });
  const control = async (path, body) => {
    const response = await fetch(
      `http://127.0.0.1:${identity.controlPort}${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : {},
    );
    if (!response.ok)
      throw new Error(`Fixture ${path} returned ${response.status}`);
    return response.json();
  };
  return {
    ...identity,
    url: `http://127.0.0.1:${PORT}`,
    chunk: (content) => control("/chunk", { content }),
    finish: () => control("/finish", {}),
    openStreams: async () => (await control("/streams")).open,
    async stop() {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
      await rm(identity.workspace, { recursive: true, force: true });
    },
  };
}

/**
 * Counts components React rendered, through the DevTools hook that production
 * React also calls on every commit. A broken memo adds no commits, only renders.
 * Also signs the fixture user in with onboarding complete.
 */
function installRenderCounter(userId) {
  // Function, class, forwardRef, and simple memo components; tags from React's fiber types.
  const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
  const PERFORMED_WORK = 1;
  window.reactRenders = 0;
  window.reactRowMounts = {};
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_rendererId, root) {
      const stack = [root.current];
      while (stack.length) {
        const fiber = stack.pop();
        const rendered =
          fiber.alternate === null || (fiber.flags & PERFORMED_WORK) !== 0;
        if (
          window.reactRowMounts &&
          fiber.alternate === null &&
          fiber.tag === 5 &&
          fiber.stateNode?.hasAttribute("data-index")
        ) {
          const index = fiber.stateNode.getAttribute("data-index");
          window.reactRowMounts[index] =
            (window.reactRowMounts[index] ?? 0) + 1;
        }
        if (rendered && COMPONENT_TAGS.has(fiber.tag)) window.reactRenders++;
        if (fiber.sibling) stack.push(fiber.sibling);
        // A bailed-out subtree keeps its previous children and did no work this commit.
        if (fiber.child && fiber.child !== fiber.alternate?.child)
          stack.push(fiber.child);
      }
    },
  };
  localStorage.setItem("euler:userUuid", userId);
  localStorage.setItem(`euler:onboarding:${userId}`, "complete");
}

/** Installs page observers once; each measured window then resets `window.perfProbe`. */
async function installProbe(page) {
  await page.evaluate(() => {
    window.resetPerfProbe = () => {
      window.perfProbe = {
        started: performance.now(),
        frames: [],
        longTasks: [],
        events: [],
      };
    };
    window.resetPerfProbe();
    let last = performance.now();
    function frame(now) {
      if (last >= window.perfProbe.started)
        window.perfProbe.frames.push(now - last);
      last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.startTime >= window.perfProbe.started)
          window.perfProbe.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: false });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.interactionId) window.perfProbe.events.push(entry.duration);
    }).observe({ type: "event", durationThreshold: 16 });
  });
}

async function nextFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** API requests the app is waiting on, other than timer polls and the event stream. */
const requestsInFlight = new Set();

function trackRequests(page) {
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (
      pathname.startsWith("/api/") &&
      pathname !== "/api/events" &&
      !pollName(request.url())
    )
      requestsInFlight.add(request);
  });
  for (const event of ["requestfinished", "requestfailed"])
    page.on(event, (request) => requestsInFlight.delete(request));
}

/**
 * Waits until no API request is in flight, every mounted image has loaded or
 * failed, and every finite CSS animation has finished. Responses, load, and
 * animation-end handlers render, so without this a slower machine would move
 * those renders across the end of a window. A response can start another
 * request, such as marking a chat viewed and then refreshing the chat list.
 */
async function settle(page) {
  for (let attempt = 0; requestsInFlight.size > 0; attempt++) {
    if (attempt === 500) throw new Error("An API request did not finish");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Image onLoad, IntersectionObserver, and ResizeObserver callbacks can queue
  // more layout work after two frames. Do not start another scroll step until
  // renders and scroll geometry have stayed unchanged across three samples.
  let previous;
  let stable = 0;
  for (let attempt = 0; attempt < 500; attempt++) {
    await page.waitForFunction(
      () =>
        document.fonts.status === "loaded" &&
        [...document.querySelectorAll("img")].every(
          (image) => image.complete,
        ) &&
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.playState !== "running" ||
              animation.effect?.getComputedTiming().endTime ===
                Number.POSITIVE_INFINITY,
          ),
    );
    await nextFrames(page);
    const current = await page.evaluate(() =>
      JSON.stringify([
        window.reactRenders,
        document.fonts.status,
        [...document.querySelectorAll("main .overflow-y-auto")].map((node) => [
          node.scrollTop,
          node.scrollHeight,
          node.clientHeight,
        ]),
        [...document.querySelectorAll("img")].every((image) => image.complete),
      ]),
    );
    stable =
      current === previous && requestsInFlight.size === 0 ? stable + 1 : 0;
    if (stable === 3) return;
    previous = current;
  }
  throw new Error("The page did not settle");
}

/** Runs `action` between two quiescent points and returns the components rendered. */
async function countRenders(page, action) {
  await settle(page);
  await page.evaluate(() => {
    window.reactRenders = 0;
    window.reactRowMounts = {};
  });
  await action();
  await settle(page);
  return page.evaluate(() => window.reactRenders);
}

/** The app's timer-driven requests, by path. They render on their own schedule. */
const POLLS = { health: "/api/ollama/health" };
const pollsInFlight = new Map();

function pollName(url) {
  const { pathname } = new URL(url);
  return Object.keys(POLLS).find((name) => POLLS[name] === pathname);
}

function trackPolls(page) {
  page.on("request", (request) => {
    const name = pollName(request.url());
    if (name) pollsInFlight.set(request, name);
  });
  for (const event of ["requestfinished", "requestfailed"])
    page.on(event, (request) => pollsInFlight.delete(request));
}

/** Waits for whole poll round trips instead of wall-clock time. */
async function waitForPolls(page, count, name = "health") {
  for (let poll = 0; poll < count; poll++)
    await page.waitForResponse((response) => pollName(response.url()) === name);
  await nextFrames(page);
}

/**
 * Holds the named polls for the duration of `action`, starting once none of
 * their requests is in flight. The health poll runs on a fixed interval, so
 * held requests queue up; they are answered after the window closes.
 */
async function holdPolls(page, names, action) {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const held = new Set();
  const continued = [];
  const matches = (url) => names.includes(pollName(url.href));
  const handler = (route) => {
    held.add(route.request());
    const done = released.then(() => route.continue()).catch(() => {});
    continued.push(done);
    return done;
  };
  await page.route(matches, handler);
  for (let attempt = 0; ; attempt++) {
    const landing = [...pollsInFlight].some(
      ([request, name]) => names.includes(name) && !held.has(request),
    );
    if (!landing) break;
    if (attempt === 500) throw new Error("A poll request did not finish");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await nextFrames(page);
  try {
    return await action();
  } finally {
    release();
    await Promise.all(continued);
    await page.unroute(matches, handler);
  }
}

/** Scrolls the conversation, the tallest scroll container in `<main>`. */
async function scrollToFraction(page, fraction) {
  await page.evaluate((value) => {
    const conversation = [...document.querySelectorAll("main *")]
      .filter(
        (element) =>
          getComputedStyle(element).overflowY === "auto" &&
          element.scrollHeight > element.clientHeight,
      )
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    conversation.scrollTop =
      (conversation.scrollHeight - conversation.clientHeight) * value;
  }, fraction);
  await nextFrames(page);
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (value) => document.querySelector("main")?.textContent.includes(value),
    text,
  );
}

/** Sends a message and waits until the fake Ollama holds its reply stream open. */
async function startReply(page, fixture, text) {
  await page.getByPlaceholder(COMPOSER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  for (let attempt = 0; (await fixture.openStreams()) === 0; attempt++) {
    if (attempt === 500) throw new Error("The reply stream did not open");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await page.getByRole("button", { name: "Stop generation" }).waitFor();
}

/** Streams one token at a time, waiting for each to render before the next. */
async function streamTokens(page, fixture, count, tag) {
  for (let index = 0; index < count; index++) {
    await fixture.chunk(` ${tag}${index}`);
    await waitForText(page, `${tag}${index}`);
    await nextFrames(page);
  }
}

async function finishReply(page, fixture) {
  await fixture.finish();
  await page
    .getByRole("button", { name: "Stop generation" })
    .waitFor({ state: "detached" });
}

async function bundleSizes(loadedScripts) {
  const assets = join(ROOT, "dist/assets");
  const sizes = { js: 0, css: 0 };
  for (const name of await readdir(assets)) {
    const extension = name.split(".").pop();
    // Shiki ships a lazy chunk per language; count only the scripts the app loaded.
    if (extension === "js" && !loadedScripts.has(name)) continue;
    if (extension in sizes)
      sizes[extension] += gzipSync(await readFile(join(assets, name))).length;
  }
  return sizes;
}

async function responseBytes(fixture, path) {
  const response = await fetch(`${fixture.url}${path}`, {
    headers: { "X-Euler-User-ID": fixture.userId },
  });
  return (await response.arrayBuffer()).byteLength;
}

/** Counts of work the app does for scripted interactions at the stress workload. */
async function measureCounts(page, fixture) {
  const metrics = {};
  const scrollSamples = [];
  const snapshot = () =>
    page.evaluate(() => ({
      domNodes: document.querySelectorAll("*").length,
      animations: document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
    }));

  await settle(page);
  const idle = await snapshot();
  metrics["idle.domNodes"] = idle.domNodes;
  metrics["idle.animations"] = idle.animations;

  metrics["health.rendersPerPoll"] = await countRenders(page, () =>
    waitForPolls(page, 1),
  );

  metrics["scroll.renders"] = await holdPolls(page, ["health"], () =>
    countRenders(page, async () => {
      for (let step = 0; step <= COUNT_SCROLL_STEPS; step++) {
        await scrollToFraction(page, 1 - step / COUNT_SCROLL_STEPS);
        await settle(page);
        scrollSamples.push(
          await page.evaluate((step) => {
            const rows = [...document.querySelectorAll("main [data-index]")];
            const scroller =
              rows[0]?.parentElement?.closest(".overflow-y-auto");
            return {
              step,
              renders: window.reactRenders,
              mounts: window.reactRowMounts,
              scrollTop: scroller?.scrollTop,
              scrollHeight: scroller?.scrollHeight,
              rows: rows.map((row) => ({
                index: Number(row.getAttribute("data-index")),
                height: row.getBoundingClientRect().height,
              })),
            };
          }, step),
        );
      }
    }),
  );
  await scrollToFraction(page, 1);

  const composer = page.getByPlaceholder(COMPOSER);
  await composer.fill("");
  metrics["typing.renders"] = await holdPolls(page, ["health"], () =>
    countRenders(page, () => composer.pressSequentially(TYPED_TEXT)),
  );

  await composer.fill("");
  let fileRequests = 0;
  const countFileRequest = (request) => {
    if (new URL(request.url()).pathname.endsWith("/workspace/files"))
      fileRequests++;
  };
  page.on("request", countFileRequest);
  try {
    metrics["autocomplete.renders"] = await holdPolls(page, ["health"], () =>
      countRenders(page, async () => {
        await composer.pressSequentially("@src/perf", { delay: 30 });
        await page
          .locator("#file-picker")
          .getByRole("button")
          .first()
          .waitFor();
        if (
          (await page.locator("#file-picker").getByRole("button").count()) !== 8
        )
          throw new Error(
            "The fixture's eight workspace files were not suggested",
          );
      }),
    );
    metrics["autocomplete.requests"] = fileRequests;
  } finally {
    page.off("request", countFileRequest);
  }

  await startReply(page, fixture, "Stream a reply");
  // The first token mounts the live reply; measure steady-state streaming.
  await streamTokens(page, fixture, 1, "warmup");
  metrics["stream.renders"] = await holdPolls(page, ["health"], () =>
    countRenders(page, () =>
      streamTokens(page, fixture, STREAM_CHUNKS, "token"),
    ),
  );
  metrics["finishReply.renders"] = await holdPolls(page, ["health"], () =>
    countRenders(page, () => finishReply(page, fixture)),
  );

  await page.getByRole("button", { name: "Toggle chats" }).click();
  await settle(page);
  metrics["openChat.renders"] = await holdPolls(page, ["health"], () =>
    countRenders(page, async () => {
      await page.getByRole("button", { name: "Session 98" }).click();
      await page.waitForURL(`**/run/${fixture.longSessions[1]}`);
      await waitForText(page, `Reply ${WORKLOAD.longSessionMessages - 1}`);
    }),
  );

  metrics["api.sessionResponseBytes"] = await responseBytes(
    fixture,
    `/api/sessions/${fixture.longSessions[0]}`,
  );
  metrics["api.sessionsResponseBytes"] = await responseBytes(
    fixture,
    "/api/sessions",
  );
  return { metrics, scrollSamples };
}

/** Verify the fixture's bundled fonts and record what Chromium actually used. */
async function resolvedFonts(cdp) {
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const fonts = {};
  for (const [selector, family] of [
    ["main p", "Geist"],
    ["main p code", "Geist Mono"],
    ["main pre code span span", "Geist Mono"],
  ]) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) throw new Error(`The font sample ${selector} is missing`);
    fonts[selector] = (
      await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    ).fonts;
    if (
      fonts[selector].length === 0 ||
      fonts[selector].some(
        (font) => !font.isCustomFont || font.familyName !== family,
      )
    )
      throw new Error(
        `The font sample ${selector} did not use bundled ${family}`,
      );
  }
  await cdp.send("CSS.disable");
  await cdp.send("DOM.disable");
  return fonts;
}

/** Wall-clock samples under CPU throttling. Reported for trends; too noisy to gate on. */
async function measureTimings(page, cdp, fixture) {
  const metricMap = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
  };
  const measureWindow = async (action) => {
    await page.evaluate(() => window.resetPerfProbe());
    const before = await metricMap();
    await action();
    const after = await metricMap();
    const samples = await page.evaluate(() => window.perfProbe);
    return {
      samples,
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    };
  };
  const runs = [];
  for (let run = 0; run < TIMING_RUNS; run++) {
    await scrollToFraction(page, 1);
    const idle = await measureWindow(() => page.waitForTimeout(5000));
    const scroll = await measureWindow(async () => {
      for (let step = 0; step <= TIMING_SCROLL_STEPS; step++)
        await scrollToFraction(page, 1 - step / TIMING_SCROLL_STEPS);
    });
    await scrollToFraction(page, 1);
    const composer = page.getByPlaceholder(COMPOSER);
    await composer.fill("");
    const typing = await measureWindow(() =>
      composer.pressSequentially(TYPED_TEXT, { delay: 30 }),
    );
    await startReply(page, fixture, `Timing run ${run}`);
    await streamTokens(page, fixture, 1, `warmup${run}x`);
    const stream = await measureWindow(() =>
      streamTokens(page, fixture, 20, `timing${run}x`),
    );
    await finishReply(page, fixture);
    runs.push({
      "idle.mainThreadMs": idle.taskMs,
      "typing.mainThreadMs": typing.taskMs,
      "typing.worstInteractionMs": Math.max(0, ...typing.samples.events),
      "scroll.worstFrameMs": Math.max(0, ...scroll.samples.frames),
      "stream20.mainThreadMs": stream.taskMs,
      "stream.worstFrameMs": Math.max(0, ...stream.samples.frames),
    });
  }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return Object.fromEntries(
    Object.keys(runs[0]).map((name) => [
      name,
      Math.round(median(runs.map((sample) => sample[name]))),
    ]),
  );
}

function compare(metrics, baseline) {
  return Object.entries(metrics).map(([name, value]) => {
    const entry = baseline.metrics[name];
    if (!entry) return { name, value, status: "new" };
    const ceiling = entry.value * (1 + entry.tolerance) + entry.slack;
    const floor = entry.value * (1 - entry.tolerance) - entry.slack;
    const status =
      value > ceiling ? "regressed" : value < floor ? "improved" : "ok";
    return { name, value, baseline: entry.value, status };
  });
}

function report(rows, timings) {
  const lines = [
    "| Metric | Baseline | Current | Status |",
    "| --- | ---: | ---: | --- |",
    ...rows.map(
      ({ name, value, baseline, status }) =>
        `| ${name} | ${baseline ?? "—"} | ${value} | ${status} |`,
    ),
    "",
    `Wall-clock medians of ${TIMING_RUNS} runs at ${TIMING_CPU_SLOWDOWN}× CPU throttling (report only):`,
    "",
    "| Timing | ms |",
    "| --- | ---: |",
    ...Object.entries(timings).map(([name, value]) => `| ${name} | ${value} |`),
  ];
  return `${lines.join("\n")}\n`;
}

const baseline = JSON.parse(
  await readFile(BASELINE_PATH, "utf8").catch(() => '{"metrics":{}}'),
);
const fixture = await startFixture();
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(installRenderCounter, fixture.userId);
  // Exercise link previews without depending on an external site's response.
  await context.route("https://example.com/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  page.on("pageerror", (error) => errors.push(error.message));
  const loadedScripts = new Set();
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/assets/") && pathname.endsWith(".js"))
      loadedScripts.add(pathname.slice("/assets/".length));
  });
  trackPolls(page);
  trackRequests(page);
  await page.goto(`${fixture.url}/run/${fixture.longSessions[0]}`);
  await waitForText(page, `Reply ${WORKLOAD.longSessionMessages - 1}`);
  // Inline code and other font-mono elements also use the bundled font.
  await page.evaluate(async () => {
    document.documentElement.style.setProperty(
      "--font-mono",
      '"Geist Mono", monospace',
    );
    await document.fonts.ready;
  });
  await installProbe(page);
  await waitForPolls(page, 2);
  const fonts = await resolvedFonts(cdp);
  const { metrics, scrollSamples } = await measureCounts(page, fixture);
  // Mount diagnostics belong to count windows, not the throttled timing pass.
  await page.evaluate(() => {
    window.reactRowMounts = null;
  });
  const bundle = await bundleSizes(loadedScripts);
  metrics["bundle.jsGzipBytes"] = bundle.js;
  metrics["bundle.cssGzipBytes"] = bundle.css;
  // Counts do not depend on CPU speed; throttle only the timing pass.
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: TIMING_CPU_SLOWDOWN,
  });
  const timings = await measureTimings(page, cdp, fixture);
  if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);

  const rows = compare(metrics, baseline);
  const summary = report(rows, timings);
  console.log(summary);
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(
    join(OUTPUT, "check.json"),
    JSON.stringify(
      { browser: browser.version(), metrics, timings, fonts, scrollSamples },
      null,
      2,
    ),
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Performance budget\n\n${summary}`,
    );

  if (update) {
    // Only out-of-band values move the baseline; resampling noise must not ratchet it.
    const next = Object.fromEntries(
      rows.map(({ name, value, status }) => [
        name,
        status === "ok"
          ? baseline.metrics[name]
          : { tolerance: 0, slack: 0, ...baseline.metrics[name], value },
      ]),
    );
    await writeFile(
      BASELINE_PATH,
      `${JSON.stringify({ workload: WORKLOAD, metrics: next }, null, 2)}\n`,
    );
    console.log(`Updated ${BASELINE_PATH}`);
  } else if (
    rows.some((row) => row.status === "regressed" || row.status === "new")
  ) {
    console.error(
      "Performance budget exceeded or a metric has no baseline. Fix the regression, or accept it with `bun run perf:check --update` and justify the baseline change in review.",
    );
    process.exitCode = 1;
  } else if (rows.some((row) => row.status === "improved")) {
    console.log(
      "Improvements detected. Run `bun run perf:check --update` to lock them in.",
    );
  }
} finally {
  await browser?.close();
  await fixture.stop();
}
