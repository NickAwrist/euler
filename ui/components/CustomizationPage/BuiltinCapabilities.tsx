import { useState } from "react";
import type { Capabilities } from "../../../src/schemas/userPreferences";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../../persist/userPreferences";
import { eyebrowText } from "../../styles";
import { SwitchField } from "./SwitchField";

const CAPABILITIES: { id: keyof Capabilities; label: string; hint: string }[] =
  [
    {
      id: "web",
      label: "Web search",
      hint: "Search the web and read web pages.",
    },
    {
      id: "imageGeneration",
      label: "Image generation",
      hint: "Generate images with ComfyUI.",
    },
    {
      id: "shell",
      label: "Shell",
      hint: "Run commands in the sandboxed workspace.",
    },
    {
      id: "files",
      label: "Files",
      hint: "Read, search, create, edit, and delete workspace files.",
    },
  ];

/** Built-in tools agents may use. Turn one off to prefer an MCP server's tool. */
export function BuiltinCapabilities() {
  const [capabilities, setCapabilities] = useState(
    () => getUserPreferences().capabilities,
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: keyof Capabilities, enabled: boolean) => {
    setError(null);
    setCapabilities((current) => ({ ...current, [id]: enabled }));
    updateUserPreferences({ capabilities: { [id]: enabled } })
      .then((saved) => setCapabilities(saved.capabilities))
      .catch((saveError: unknown) => {
        setCapabilities((current) => ({ ...current, [id]: !enabled }));
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Failed to save capability",
        );
      });
  };

  return (
    <section
      aria-labelledby="builtin-capabilities"
      className="flex flex-col gap-3"
    >
      <h2 id="builtin-capabilities" className={eyebrowText}>
        Built-in capabilities
      </h2>
      {error && (
        <p role="alert" className="text-[0.75rem] text-red-400">
          {error}
        </p>
      )}
      {CAPABILITIES.map(({ id, label, hint }) => (
        <SwitchField
          key={id}
          id={`capability-${id}`}
          label={label}
          hint={hint}
          checked={capabilities[id]}
          onChange={(enabled) => toggle(id, enabled)}
        />
      ))}
    </section>
  );
}
