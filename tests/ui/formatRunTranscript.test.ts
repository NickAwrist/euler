import { expect, test } from "bun:test";
import {
  formatRunTranscript,
  transcriptFileName,
} from "../../ui/lib/formatRunTranscript";

test("transcript has a metadata header and labels workspace events separately", () => {
  const transcript = formatRunTranscript(
    [
      { role: "user", content: "Hi" },
      { role: "event", content: "Working directory changed to /tmp/ux-dir" },
      { role: "assistant", content: "Hello" },
    ],
    {
      title: "Greeting",
      exportedAt: new Date("2026-09-25T12:00:00.000Z"),
      model: "ollama:llama3",
      streamingAssistant: "More",
    },
  );
  expect(transcript).toBe(
    [
      "# Greeting",
      "- Exported: 2026-09-25T12:00:00.000Z\n- Model: ollama:llama3",
      "USER\n===\nHi",
      "EVENT\n===\nWorking directory changed to /tmp/ux-dir",
      "MODEL\n===\nHello",
      "MODEL\n===\nMore",
    ].join("\n\n"),
  );
});

test("transcript file names are slugs of the chat title", () => {
  expect(transcriptFileName("$haiku-writer about a local LLM ...")).toBe(
    "haiku-writer-about-a-local-llm.md",
  );
  expect(transcriptFileName("Café / notes")).toBe("café-notes.md");
  expect(transcriptFileName("???")).toBe("chat.md");
});
