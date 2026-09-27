// Isolated HTTP backend for browser tests. No real model or production data.
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
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      return original(input, init);
    return Response.json(
      { error: "External network disabled in browser fixture" },
      { status: 503 },
    );
  },
  { preconnect: original.preconnect },
);
const { app } = await import("../../src/app");
const { setOpenRouterApiKey } = await import("../../src/db");
setOpenRouterApiKey("fixture");
setOpenRouterScenario("async-agents");
setAsyncAgentDelay(1800);
app.listen(5198, "127.0.0.1", () => console.log("async fixture ready"));
