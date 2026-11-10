import { app } from "./app";
import { envConfig } from "./env";
import { startPushNotifications } from "./notifications";
import { logEvent } from "./observability/logger";

startPushNotifications();

const PORT = envConfig.backendPort;
app.listen(PORT, envConfig.backendHost, () => {
  logEvent("info", "server.listening", {
    port: PORT,
    host: envConfig.backendHost,
  });
});
