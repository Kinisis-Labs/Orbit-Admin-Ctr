import { Router, type IRouter } from "express";
import { GetTagComplianceResponse } from "@workspace/api-zod";
import { fetchTagCompliance } from "../lib/azureTagCompliance.js";

const router: IRouter = Router();

// GET /api/global/tag-compliance
// Scans all configured subscriptions at the resource level and returns every
// entry missing at least one of the three required tags (CostCategory, Application, Environment).
// Subscription and resource-group scopes are excluded — tags are applied at individual resources only.
// Config-gated: returns dataSource:"unavailable" when AZURE_SUBSCRIPTION_IDS
// is not set so the frontend can show a setup prompt instead of empty data.
router.get("/global/tag-compliance", async (req, res) => {
  const bypassCache = req.query["refresh"] === "true";
  const result = await fetchTagCompliance({ bypassCache });
  res.json(GetTagComplianceResponse.parse(result));
});

export default router;
