import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initializeNavigation } from "./lib/navigation";
import { applyAppearance, loadAppearance } from "./persist/appearance";

initializeNavigation();
applyAppearance(loadAppearance());

const Root =
  import.meta.env.DEV && window.location.pathname === "/dev/welcome"
    ? lazy(() => import("./dev/WelcomeDemo"))
    : import.meta.env.DEV && window.location.pathname === "/dev/settings"
      ? lazy(() => import("./dev/SettingsDemo"))
      : import.meta.env.DEV && window.location.pathname === "/dev/modal"
        ? lazy(() => import("./dev/ModalDemo"))
        : import.meta.env.DEV && window.location.pathname === "/dev/usage"
          ? lazy(() => import("./dev/UsageDemo"))
          : import.meta.env.DEV && window.location.pathname === "/dev/artifacts"
            ? lazy(() => import("./dev/ArtifactsDemo"))
            : import.meta.env.DEV &&
                window.location.pathname === "/dev/messages"
              ? lazy(() => import("./dev/MessageDemo"))
              : import.meta.env.DEV &&
                  window.location.pathname === "/dev/images"
                ? lazy(() => import("./dev/ImageLoadingDemo"))
                : import.meta.env.DEV &&
                    window.location.pathname === "/dev/models"
                  ? lazy(() => import("./dev/ModelsDemo"))
                  : import.meta.env.DEV &&
                      window.location.pathname === "/dev/model-playground"
                    ? lazy(() => import("./dev/ModelPlayground"))
                    : import.meta.env.DEV &&
                        window.location.pathname === "/dev/long-thread"
                      ? lazy(() => import("./dev/LongThreadDemo"))
                      : import.meta.env.DEV &&
                          window.location.pathname === "/dev/agents"
                        ? lazy(() => import("./dev/AgentsDemo"))
                        : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);
