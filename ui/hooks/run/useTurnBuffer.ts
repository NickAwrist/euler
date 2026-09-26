import { useRef } from "react";
import type { Message, MessageVersion } from "../../types";
import { createEmptyStreamBuffer } from "./streamBuffer";

/** Refs for streaming token accumulation and reconnect hydration. */
export function useTurnBuffer() {
  const streamBufferRef = useRef(createEmptyStreamBuffer());
  const turnMessagesSnapshotRef = useRef<Message[] | null>(null);
  /** Earlier replies the in-flight reply keeps when it is a regenerate. */
  const turnVersionsRef = useRef<MessageVersion[]>([]);

  return {
    streamBufferRef,
    turnMessagesSnapshotRef,
    turnVersionsRef,
  };
}
