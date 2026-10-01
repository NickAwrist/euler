import { cx } from "../../styles";
import type { ComfyUITestState, OllamaTestState } from "./types";

const lineClass = "text-[0.75rem]";

export type ConnectionTestFeedbackModel =
  | { variant: "idle" }
  | { variant: "loading"; verifyingLabel?: string }
  | { variant: "ok"; okLabel: string }
  | { variant: "err"; message: string };

export function ollamaConnectionFeedback(
  state: OllamaTestState,
  ollamaConnected: boolean | null,
): ConnectionTestFeedbackModel {
  switch (state.status) {
    case "err":
      return { variant: "err", message: state.message };
    case "loading":
      return {
        variant: "loading",
        verifyingLabel: state.previousVersion
          ? `Connected - Ollama version ${state.previousVersion}`
          : state.holdSavedConnected
            ? "Connected"
            : undefined,
      };
    case "ok":
      return {
        variant: "ok",
        okLabel: `Connected - Ollama version ${state.version}`,
      };
    case "idle":
      if (ollamaConnected === true) {
        return { variant: "ok", okLabel: "Connected" };
      }
      return { variant: "idle" };
  }
}

export function comfyConnectionFeedback(
  state: ComfyUITestState,
  comfyuiConnected: boolean | null,
): ConnectionTestFeedbackModel {
  switch (state.status) {
    case "err":
      return { variant: "err", message: state.message };
    case "loading":
      return {
        variant: "loading",
        verifyingLabel: state.holdConnected ? "Connected" : undefined,
      };
    case "ok":
      return { variant: "ok", okLabel: "Connected" };
    case "idle":
      if (comfyuiConnected === true) {
        return { variant: "ok", okLabel: "Connected" };
      }
      return { variant: "idle" };
  }
}

export function ConnectionTestFeedback(model: ConnectionTestFeedbackModel) {
  switch (model.variant) {
    case "err":
      return (
        <output className={cx(lineClass, "block text-red-400")}>
          {model.message}
        </output>
      );
    case "loading":
      if (model.verifyingLabel) {
        return (
          <output
            className={cx(lineClass, "block text-emerald-500/90")}
            aria-live="polite"
          >
            <span className="opacity-65">{model.verifyingLabel}</span>
            <span className="text-muted-foreground"> - Verifying...</span>
          </output>
        );
      }
      return (
        <output
          className={cx(lineClass, "block text-muted-foreground")}
          aria-live="polite"
        >
          Checking connection...
        </output>
      );
    case "ok":
      return (
        <output
          className={cx(lineClass, "block text-emerald-500/90")}
          aria-live="polite"
        >
          {model.okLabel}
        </output>
      );
    default:
      return null;
  }
}
