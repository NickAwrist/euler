// Isolated HTTP backend for browser and iOS UI tests. No real model or
// production data.
process.env.EULER_DB_PATH = ":memory:";
process.env.EULER_DATA_ROOT = `/tmp/euler-async-browser-${process.pid}`;
process.env.EULER_FRONTEND_PORT = "5199";
process.env.EULER_SERVE_FRONTEND = "false";
process.env.OPENROUTER_API_KEY = "";
process.env.EULER_OPENROUTER_API_KEY = "";
process.env.EULER_OLLAMA_HOST = "";
process.env.OLLAMA_HOST = "";
const { handleOpenRouterRequest, setOpenRouterScenario, setAsyncAgentDelay } =
  await import("./mockOpenRouter");
const original = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (
      url.hostname === "openrouter.ai" &&
      url.pathname.endsWith("/chat/completions")
    )
      return handleOpenRouterRequest(input, init);
    // The scripted model is the whole catalog, so clients that list models offer it.
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/models")
      return Response.json({ data: [FIXTURE_MODEL] });
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      return original(input, init);
    return Response.json(
      { error: "External network disabled in browser fixture" },
      { status: 503 },
    );
  },
  { preconnect: original.preconnect },
);
const FIXTURE_MODEL = {
  id: "openai/gpt-5.6-terra",
  name: "OpenAI: GPT-5.6 Terra",
  created: 1700000000,
  supported_parameters: ["tools"],
  context_length: 128000,
  pricing: { prompt: "0", completion: "0.000002" },
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  },
};
const { app } = await import("../../src/app");
const { setOpenRouterApiKey } = await import("../../src/db");
const { setOpenRouterModelEnabled } = await import("../../src/db/openrouter");
setOpenRouterApiKey("fixture");
setOpenRouterModelEnabled(
  {
    route: FIXTURE_MODEL.id,
    publisherId: "openai",
    name: "GPT-5.6 Terra",
    created: FIXTURE_MODEL.created,
  },
  true,
);
setOpenRouterScenario(
  process.env.TOOL_PERMISSION_FIXTURE
    ? "tool-permissions"
    : process.env.JOB_FIXTURE
      ? "background-jobs"
      : "async-agents",
);
setAsyncAgentDelay(1800);
app.listen(Number(process.env.JOB_FIXTURE_PORT ?? 5198), "127.0.0.1", () =>
  console.log("async fixture ready"),
);
