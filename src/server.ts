import { app } from "./app";
import { envConfig } from "./env";
import { logEvent } from "./observability/logger";

const PORT = envConfig.backendPort;
app.listen(PORT, envConfig.backendHost, () => {
  logEvent("info", "server.listening", {
    port: PORT,
    host: envConfig.backendHost,
  });
});
