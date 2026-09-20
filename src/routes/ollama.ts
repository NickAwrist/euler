import { Router } from "express";
import { Ollama } from "ollama";
import { withContainerLoopbackHint } from "../containerNetworkHint";
import { setOllamaHost } from "../db/index";
import {
  getOllamaClient,
  getOllamaHostConfig,
  invalidateOllamaClientCache,
} from "../ollamaClient";
import { errorMessage } from "../utils/errors";

const ollamaRoutes = Router();

ollamaRoutes.get("/health", async (_req, res) => {
  try {
    await getOllamaClient().list();
    res.json({ connected: true });
  } catch (e) {
    res.json({
      connected: false,
      error: errorMessage(e),
    });
  }
});

ollamaRoutes.get("/config", (_req, res) => {
  res.json(getOllamaHostConfig());
});

ollamaRoutes.put("/config", (req, res) => {
  const body = req.body as { host?: unknown };
  const host = typeof body.host === "string" ? body.host.trim() : "";
  setOllamaHost(host);
  invalidateOllamaClientCache();
  res.json(getOllamaHostConfig());
});

ollamaRoutes.post("/test", async (req, res) => {
  const body = req.body as { host?: unknown };
  const raw = typeof body.host === "string" ? body.host.trim() : "";
  let client: Ollama;
  try {
    client = raw ? new Ollama({ host: raw }) : new Ollama();
  } catch (e) {
    res.json({
      ok: false,
      error: errorMessage(e),
    });
    return;
  }
  const effectiveHost = (client as unknown as { config: { host: string } })
    .config.host;
  try {
    const v = await client.version();
    res.json({
      ok: true,
      version: v.version,
      effectiveHost,
    });
  } catch (e) {
    res.json({
      ok: false,
      error: withContainerLoopbackHint(errorMessage(e), raw || effectiveHost),
      effectiveHost,
    });
  }
});

export default ollamaRoutes;
