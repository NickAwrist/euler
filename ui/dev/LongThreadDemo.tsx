import { useCallback, useState } from "react";
import { RunArea } from "../components/RunArea";
import type { Message, MessageStep } from "../types";

const steps: MessageStep[] = [
  { kind: "llm_call", status: "completed", result: "Finished" },
];
const history: Message[] = Array.from({ length: 300 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  get content() {
    // Measure history work without relying on machine-dependent frame timings.
    performance.mark("history-read");
    return index % 2 === 0
      ? `Question ${index}`
      : `Reply ${index}\n\n${"A paragraph with **bold**, [a link](https://example.com), and `inline code`.\n\n".repeat(6)}\n| Name | Value |\n| --- | --- |\n| Example | 42 |`;
  },
  steps: index % 2 === 0 ? undefined : steps,
}));
const noOp = () => {};
const noSteps: MessageStep[] = [];

export default function LongThreadDemo() {
  const [messages, setMessages] = useState(history);
  const [input, setInput] = useState("");
  const [content, setContent] = useState("Streaming reply");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const cancelEdit = useCallback(() => setEditing(null), []);

  return (
    <div className="h-screen">
      <RunArea
        messages={messages}
        sessionLoadState="loaded"
        sessionError={null}
        sessionSendReady
        onRetryLoad={noOp}
        streamingSteps={noSteps}
        streamingStep={null}
        streamingContent={content}
        streamingThinking=""
        runPending={busy}
        footerInset={100}
        onViewSteps={noOp}
        editingUserIndex={editing}
        onStartEditUser={setEditing}
        onCancelEditUser={cancelEdit}
        onRequestEditConfirm={noOp}
        onRegenerate={noOp}
        regenerateLabel="Regenerate"
      />
      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-3 bg-background p-4">
        <button type="button" onClick={() => setEditing(0)}>
          Edit first message
        </button>
        <input
          aria-label="Composer"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            setContent((value) => `${value}\n\nMore **streamed** text.`)
          }
        >
          Stream token
        </button>
        <button type="button" onClick={() => setBusy((value) => !value)}>
          Toggle busy
        </button>
        <button
          type="button"
          onClick={() => {
            setMessages((value) => [...value, { role: "assistant", content }]);
            setContent("");
          }}
        >
          Finish
        </button>
      </div>
    </div>
  );
}
