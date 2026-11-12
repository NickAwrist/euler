import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "cors";
import express from "express";
import { agentRuntime } from "./agents/runtime/AgentRuntime";
import { getDb } from "./db/index";
import { envConfig } from "./env";
import {
  errorHandler,
  requestObservability,
  sendError,
} from "./observability/http";
import comfyuiRoutes from "./routes/comfyui";
import faviconsRoutes from "./routes/favicons";
import mcpOAuthRoutes from "./routes/mcpOAuth";
import { rpcMiddleware } from "./rpc/routes";
import { startSessionExpiry } from "./sessions/lifecycle";
import { workspaceService } from "./workspaces/WorkspaceService";

getDb();
// Recover before the server accepts requests so no live turn looks interrupted.
agentRuntime.recover();
startSessionExpiry();
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
app.use(requestObservability);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: false,
    allowedHeaders: [
      "Content-Type",
      "X-Euler-User-ID",
      "Connect-Protocol-Version",
      "Connect-Timeout-Ms",
    ],
    exposedHeaders: ["Grpc-Status", "Grpc-Message", "X-Request-Id"],
  }),
);
app.use(rpcMiddleware());
app.use("/api/comfyui", comfyuiRoutes);
app.use("/api/favicons", faviconsRoutes);
app.use("/api/mcp/oauth", mcpOAuthRoutes);

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
  sendError(res, "NOT_FOUND", "API route not found");
});

app.use(errorHandler);
