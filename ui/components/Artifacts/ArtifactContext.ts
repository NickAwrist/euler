import { createContext, useContext } from "react";
import type { SessionWorkspace } from "../../types";
export const ArtifactContext = createContext<{
  openFile: (path: string) => void;
  workspaceKind: SessionWorkspace["kind"];
  localPath?: string;
} | null>(null);
export const useArtifacts = () => useContext(ArtifactContext);

export function artifactPath(value: string, localPath?: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(value).replace(/[#?].*$/, "");
  } catch {
    return null;
  }
  if (!path || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path))
    return null;
  if (localPath && path.startsWith(`${localPath}/`))
    path = path.slice(localPath.length + 1);
  else if (path.startsWith("/workspace/")) path = path.slice(11);
  else if (path.startsWith("/")) return null;
  path = path.replace(/^\.\//, "");
  if (path.split("/").includes("..") || !path || path.endsWith("/"))
    return null;
  return path;
}
