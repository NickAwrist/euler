import { create } from "@bufbuild/protobuf";
import { useCallback, useState } from "react";
import {
  MessageVersionSchema,
  Message_Role,
} from "../../src/gen/euler/v1/sessions_pb";
import { Step_Kind, Step_Status } from "../../src/gen/euler/v1/steps_pb";
import { RunArea } from "../components/RunArea";
import type { Message, Step } from "../types";
import { fixtureMessage, fixtureStep } from "./fixtures";

const steps: Step[] = [
  fixtureStep({
    kind: Step_Kind.LLM_CALL,
    status: Step_Status.DONE,
    result: "Finished",
    thinking: "Reasoning for this reply",
  }),
];
// Built by hand rather than with create(), which would read content up front.
const history: Message[] = Array.from({ length: 300 }, (_, index) => ({
  $typeName: "euler.v1.Message" as const,
  role: index % 2 === 0 ? Message_Role.USER : Message_Role.ASSISTANT,
  get content() {
    // Measure history work without relying on machine-dependent frame timings.
    performance.mark("history-read");
    return index % 2 === 0
      ? `Question ${index}`
      : `Reply ${index}\n\n${"A paragraph with **bold**, [a link](https://example.com), and `inline code`.\n\n".repeat(6)}\n| Name | Value |\n| --- | --- |\n| Example | 42 |`;
  },
  steps: index % 2 === 0 ? [] : steps,
  attachments: [],
  versions:
    index === 1
      ? [
          create(MessageVersionSchema, {
            content: "Earlier reply version",
            steps,
          }),
        ]
      : [],
}));
const noOp = () => {};
const noSteps: Step[] = [];

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
        <button
          type="button"
          onClick={() =>
            setMessages((value) => value.map((message) => ({ ...message })))
          }
        >
          Refresh history
        </button>
        <button type="button" onClick={() => setBusy((value) => !value)}>
          Toggle busy
        </button>
        <button
          type="button"
          onClick={() => {
            setMessages((value) => [
              ...value,
              fixtureMessage("assistant", content),
            ]);
            setContent("");
          }}
        >
          Finish
        </button>
      </div>
    </div>
  );
}
