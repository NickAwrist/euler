import { OllamaContextWindow } from "../../../src/gen/euler/v1/providers_pb";
import { cx, eyebrowText } from "../../styles";
import {
  ConnectionTestFeedback,
  connectionFeedback,
} from "./ConnectionTestFeedback";
import { EnvironmentSettingHint } from "./EnvironmentSettingHint";
import { type Option, OptionSelect } from "./OptionSelect";
import { inputClass, labelClass } from "./constants";
import type { ConnectionTestState } from "./types";

const contextWindows: Option<OllamaContextWindow>[] = [
  { id: OllamaContextWindow.LOW, name: "Low - 32k" },
  { id: OllamaContextWindow.MEDIUM, name: "Medium - 128k" },
  { id: OllamaContextWindow.HIGH, name: "High - 256k" },
];

const CONTEXT_WINDOW_SLUGS: Record<OllamaContextWindow, string> = {
  [OllamaContextWindow.UNSPECIFIED]: "low",
  [OllamaContextWindow.LOW]: "low",
  [OllamaContextWindow.MEDIUM]: "medium",
  [OllamaContextWindow.HIGH]: "high",
};

export function OllamaSettingsTab({
  environmentManaged,
  ollamaUri,
  onOllamaUriInput,
  ollamaConnected,
  testState,
  onTestOllama,
  contextWindow,
}: {
  environmentManaged: boolean | undefined;
  ollamaUri: string;
  onOllamaUriInput: (value: string) => void;
  ollamaConnected: boolean | null;
  testState: ConnectionTestState;
  onTestOllama: () => void;
  /** Omitted where only the address is set up. */
  contextWindow?: {
    value: OllamaContextWindow;
    onChange: (value: OllamaContextWindow) => void;
  };
}) {
  return (
    <section className="space-y-4">
      <h2 className={cx(eyebrowText, "mb-4")}>Ollama</h2>

      <div className="space-y-2">
        <label htmlFor="ollamaUri" className={labelClass}>
          Server URL
        </label>
        <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
          <input
            type="text"
            id="ollamaUri"
            aria-describedby="ollamaUri-environment"
            name="ollamaUri"
            value={ollamaUri}
            disabled={environmentManaged !== false}
            onChange={(event) => onOllamaUriInput(event.target.value)}
            placeholder="http://127.0.0.1:11434"
            autoComplete="off"
            className={cx(inputClass, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => void onTestOllama()}
            disabled={testState.status === "loading"}
            className="shrink-0 rounded-lg border border-border-subtle bg-muted/40 px-3 py-2 text-[0.875rem] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {testState.status === "loading" ? "Testing..." : "Test connection"}
          </button>
        </div>
        <EnvironmentSettingHint
          id="ollamaUri-environment"
          managed={environmentManaged}
        >
          Leave empty to use the default local Ollama address
          (http://127.0.0.1:11434).
        </EnvironmentSettingHint>
        <ConnectionTestFeedback
          {...connectionFeedback(testState, ollamaConnected)}
        />
      </div>

      {contextWindow && (
        <OptionSelect
          id="ollamaContextWindow"
          label="Context window"
          value={contextWindow.value}
          options={contextWindows}
          slugs={CONTEXT_WINDOW_SLUGS}
          onChange={contextWindow.onChange}
        />
      )}
    </section>
  );
}
