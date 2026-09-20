import { apiJson } from "../lib/api";

export type DirectoryListing = {
  path: string;
  exact: boolean;
  parent: string | null;
  directories: { name: string; path: string }[];
};

export function fetchDirectories(
  path: string,
  signal: AbortSignal,
): Promise<DirectoryListing> {
  return apiJson<DirectoryListing>(
    `/api/directories?path=${encodeURIComponent(path)}`,
    { signal },
  );
}
