export type { SessionWorkspace } from "../../src/schemas/sessions";

export type WorkspaceFile = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};
