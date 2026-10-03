import { Router } from "express";
import { getUsageDashboard } from "../db/usage";
import { sendError } from "../observability/http";
import { UsageQuery } from "../usage";
import { requireUserId } from "../userIdentity";
const router = Router();
router.get("/", (req, res) => {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const query = UsageQuery.safeParse(req.query);
  if (!query.success) {
    sendError(res, "INVALID_REQUEST", "Invalid usage filters or sort rules");
    return;
  }
  res.json(getUsageDashboard(owner, query.data));
});
export default router;
