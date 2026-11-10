import type { ServiceImpl } from "@connectrpc/connect";
import type { DirectoryService } from "../gen/euler/v1/directories_pb";
import { listDirectory } from "../workspaces/directories";
import { ownerOf } from "./context";

export const directoryService: ServiceImpl<typeof DirectoryService> = {
  async listDirectory(request, context) {
    ownerOf(context);
    const listing = await listDirectory(request.path);
    return { ...listing, parent: listing.parent ?? undefined };
  },
};
