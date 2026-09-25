export type SessionWorkspace =
  | { kind: "sandbox" }
  | { kind: "local"; path: string; label: string };

export type WorkspaceFile = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};
