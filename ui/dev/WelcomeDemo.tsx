import { useState } from "react";
import { RunInputDock } from "../components/RunInputDock";
import { WelcomeHome } from "../components/WelcomeHome";

const noop = () => {};

export default function WelcomeDemo() {
  const params = new URLSearchParams(window.location.search);
  const [input, setInput] = useState("");
  const [composerHeight, setComposerHeight] = useState(104);
  const [chat, setChat] = useState(0);
  return (
    <main className="relative h-dvh bg-background">
      <button
        type="button"
        onClick={() => setChat((value) => value + 1)}
        className="absolute left-6 top-5 z-10 text-sm text-muted-foreground"
      >
        New chat
      </button>
      <WelcomeHome
        key={chat}
        name={params.get("name") ?? "Nick Wrist"}
        sessions={[]}
        home={params.get("home") !== "false"}
        ephemeral={params.get("ephemeral") === "true"}
        composerHeight={composerHeight}
        onNewEphemeralRun={noop}
        onOpenSession={noop}
      />
      <RunInputDock
        centered
        ollamaModels={[
          {
            id: "example",
            name: "Claude Sonnet",
            lab: "Anthropic",
            provider: "openrouter",
            inputCapabilities: ["text"],
          },
        ]}
        ollamaConnected={true}
        modelsLoadError={null}
        selectedModel="example"
        onModelChange={noop}
        input={input}
        setInput={setInput}
        onSendMessage={(event) => event.preventDefault()}
        onStopGeneration={noop}
        runPending={false}
        streamingStep={null}
        streamingSteps={[]}
        modelSendReady
        pendingImages={[]}
        imageError={null}
        addPendingImages={noop}
        removePendingImage={noop}
        canAttachImages={false}
        attachmentsSendReady
        linkedLabel={null}
        workspace={{ kind: "sandbox" }}
        onRunCommand={noop}
        onFooterHeightChange={setComposerHeight}
      />
    </main>
  );
}
