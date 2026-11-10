import type { ListDirectoryResponse } from "../../src/gen/euler/v1/directories_pb";
import { directoryClient } from "../lib/rpc";

export type DirectoryListing = ListDirectoryResponse;

export function fetchDirectories(
  path: string,
  signal: AbortSignal,
): Promise<DirectoryListing> {
  return directoryClient.listDirectory({ path }, { signal });
}
