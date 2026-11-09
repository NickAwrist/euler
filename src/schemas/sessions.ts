/** Where a chat's tools run. */
export type SessionWorkspace =
  | {
      kind: "sandbox";
      /** Present when this chat is linked to another chat's sandbox. */
      linked?: {
        workspaceId: string;
        /** Another chat using the sandbox, preferring the one that created it. */
        sessionId: string | null;
      };
    }
  | { kind: "local"; path: string; label: string };
