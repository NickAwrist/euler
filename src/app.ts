import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "cors";
import express from "express";
import { getDb } from "./db/index";
import { envConfig } from "./env";
import { errorHandler, sendApiError } from "./http/errors";
import attachmentsRoutes from "./routes/attachments";
import comfyuiRoutes from "./routes/comfyui";
import directoriesRoutes from "./routes/directories";
import modelsRoutes from "./routes/models";
import ollamaRoutes from "./routes/ollama";
import runRoutes from "./routes/runs";
import searxngRoutes from "./routes/searxng";
import sessionRoutes from "./routes/sessions";
import settingsRoutes from "./routes/settings";
import skillsRoutes from "./routes/skills";
import temporarySessionRoutes from "./routes/temporarySessions";
import usageRoutes from "./routes/usage";
import { workspaceService } from "./workspaces/WorkspaceService";

getDb();
void workspaceService.initialize();

const DEFAULT_FRONTEND_PORTS = [5173, 5174];
const allowedFrontendPorts = Array.from(
  new Set([...DEFAULT_FRONTEND_PORTS, envConfig.frontendPort]),
);
const allowedOrigins = allowedFrontendPorts.flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);

export const app = express();
app.use(
  cors({
    origin: allowedOrigins,
    credentials: false,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use("/api/usage", usageRoutes);
app.use("/api/directories", directoriesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/skills", skillsRoutes);
app.use("/api/attachments", attachmentsRoutes);
app.use("/api/comfyui", comfyuiRoutes);
app.use("/api/ollama", ollamaRoutes);
app.use("/api/searxng", searxngRoutes);
app.use("/api/models", modelsRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/temporary-sessions", temporarySessionRoutes);
app.use("/api/runs", runRoutes);

const distPath = join(process.cwd(), "dist");
const indexPath = join(distPath, "index.html");

if (envConfig.serveFrontend && existsSync(indexPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile("index.html", { root: distPath });
  });
}

app.use("/api", (_req, res) => {
  sendApiError(res, 404, "NOT_FOUND", "API route not found");
});

app.use(errorHandler);
