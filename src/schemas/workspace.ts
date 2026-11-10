/** A file in a chat's workspace. */
export type WorkspaceFile = {
  /** Relative to the workspace root. */
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};
