import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { ModelSelectBar } from "../components/ModelSelectBar";
import { OpenRouterSettingsTab } from "../components/SettingsPage/OpenRouterSettingsTab";
import { useOllamaConnection } from "../hooks/run/useOllamaConnection";
import {
  type DemoScenario,
  addDemoModel,
  demoLog,
  installDemoApi,
  removeDemoModel,
  resetDemo,
  setDemoObserver,
} from "./modelPlaygroundApi";

installDemoApi();
const scenarios: { id: DemoScenario; name: string; description: string }[] = [
  {
    id: "ready",
    name: "Ready",
    description:
      "Browse publishers, enable models, and try stars in settings or the composer. Includes a retired saved model and a free chat-only model.",
  },
  {
    id: "large",
    name: "Large catalog",
    description:
      "Long model and publisher lists to check scrolling and fixed dialog controls.",
  },
  {
    id: "empty",
    name: "Empty",
    description:
      "No catalog models or local models. Open the composer to see Favorites and Choose models.",
  },
  {
    id: "stale",
    name: "Stale catalog",
    description: "Refresh fails, but the last known catalog remains available.",
  },
  {
    id: "unavailable",
    name: "No catalog",
    description:
      "No cached catalog. Saved choices remain visible with unverified availability.",
  },
  {
    id: "errors",
    name: "Failed saves",
    description:
      "Enable, favorite, subscription, and key changes fail visibly without changing preferences.",
  },
  {
    id: "slow",
    name: "Slow requests",
    description:
      "Each request takes 1.4 seconds. Try opening a publisher or saving a preference.",
  },
];
export default function ModelPlayground() {
  const connection = useOllamaConnection();
  const [scenario, setScenario] = useState<DemoScenario>("ready");
  const [revision, setRevision] = useState(0);
  const [, setLogRevision] = useState(0);
  const [selected, setSelected] = useState("openrouter:anthropic/demo-sonnet");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setDemoObserver(() => setLogRevision((value) => value + 1));
    return () => setDemoObserver(() => {});
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      setRunning(false);
      setMessage("Demo response complete. No inference request was sent.");
    }, 4000);
    return () => clearTimeout(timer);
  }, [running]);
  useEffect(() => {
    const navigate = () =>
      document
        .getElementById("demo-settings")
        ?.scrollIntoView({ behavior: "smooth" });
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const refresh = () => {
    setRevision((value) => value + 1);
    void connection.refreshOllamaModels();
  };
  const eligible = connection.ollamaModels.some((m) => m.id === selected);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 pb-72 sm:px-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Interactive development demo
        </p>
        <h1 className="text-2xl font-semibold">Model catalog & preferences</h1>
        <p className="text-sm text-muted-foreground">
          All data lives in this page. No API key, database, or model service is
          used. Reloading resets the demo.
        </p>
      </header>
      <section
        aria-label="Demo controls"
        className="space-y-4 rounded-xl border border-border-subtle bg-card p-4"
      >
        <div className="flex flex-wrap gap-2">
          {scenarios.map((item) => (
            <Button
              key={item.id}
              variant={scenario === item.id ? "primary" : "secondary"}
              aria-pressed={scenario === item.id}
              onClick={() => {
                resetDemo(item.id);
                setScenario(item.id);
                setSelected("openrouter:anthropic/demo-sonnet");
                setMessage("");
                refresh();
              }}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {scenarios.find((item) => item.id === scenario)?.description}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              addDemoModel();
              refresh();
            }}
          >
            Add future Anthropic model
          </Button>
          <Button
            variant="secondary"
            disabled={!selected.startsWith("openrouter:")}
            onClick={() => {
              removeDemoModel(selected.replace(/^openrouter:/, ""));
              refresh();
            }}
          >
            Remove selected from catalog
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          To try subscriptions: enable Auto-enable new models in Anthropic,
          close the dialog, then add a future model here. It is enabled as soon
          as it is discovered. Scenario buttons reset preferences.
        </p>
        <details>
          <summary className="cursor-pointer text-sm">
            Recent demo activity
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {demoLog().map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ul>
        </details>
      </section>
      <section id="demo-settings" aria-label="OpenRouter settings">
        <OpenRouterSettingsTab
          key={revision}
          onModelsChanged={connection.refreshOllamaModels}
        />
      </section>
      <section
        aria-label="Demo composer"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-background/95 p-4 backdrop-blur"
      >
        <div className="mx-auto max-w-5xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ModelSelectBar
              ollamaModels={connection.ollamaModels}
              ollamaConnected={connection.ollamaConnected}
              modelsLoadError={connection.modelsLoadError}
              selectedModel={selected}
              onModelChange={setSelected}
              disabled={running}
            />
            <Button
              variant="primary"
              disabled={!eligible || running}
              loading={running}
              onClick={() => {
                setRunning(true);
                setMessage(
                  "Demo request running. You can change settings while it finishes.",
                );
              }}
            >
              {running ? "Running demo..." : "Simulate a message"}
            </Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            Selected: {selected}
          </p>
          {!eligible && (
            <p className="text-sm text-amber-400">
              Choose an available model before sending. Your previous selection
              is preserved.
            </p>
          )}
          <output className="block text-sm text-muted-foreground">
            {message}
          </output>
        </div>
      </section>
    </main>
  );
}
