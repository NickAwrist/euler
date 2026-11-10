import type { ServiceImpl } from "@connectrpc/connect";
import { getUsageDashboard } from "../db/usage";
import type { UsageService } from "../gen/euler/v1/usage_pb";
import { usageQuery, usageResponse } from "../usage/wire";
import { ownerOf } from "./context";

export const usageService: ServiceImpl<typeof UsageService> = {
  getUsage(request, context) {
    return usageResponse(
      getUsageDashboard(ownerOf(context), usageQuery(request)),
    );
  },
};
