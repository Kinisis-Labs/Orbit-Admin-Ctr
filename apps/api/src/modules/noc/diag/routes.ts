/**
 * GET /api/noc/diag
 *
 * Admin-only diagnostic endpoint. Tests token acquisition and basic API
 * reachability for every NOC data source. Returns a status report with no
 * secrets — useful for debugging "all empty" issues without reading logs.
 */
import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";

const router: IRouter = Router();

interface DiagResult {
  check: string;
  status: "ok" | "fail" | "skip";
  detail: string;
}

async function tryToken(
  label: string,
  resource: string,
): Promise<{ token: string | null; result: DiagResult }> {
  const miEndpoint = process.env.IDENTITY_ENDPOINT;
  const miHeader = process.env.IDENTITY_HEADER;

  if (miEndpoint && miHeader) {
    try {
      const res = await fetch(
        `${miEndpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`,
        { headers: { "X-IDENTITY-HEADER": miHeader } },
      );
      const body = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(body) as { access_token: string };
        return {
          token: parsed.access_token,
          result: { check: `${label} — Managed Identity token`, status: "ok", detail: "MI token acquired" },
        };
      }
      return {
        token: null,
        result: {
          check: `${label} — Managed Identity token`,
          status: "fail",
          detail: `MI HTTP ${res.status}: ${body.slice(0, 200)}`,
        },
      };
    } catch (e) {
      return {
        token: null,
        result: {
          check: `${label} — Managed Identity token`,
          status: "fail",
          detail: String(e),
        },
      };
    }
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (tenantId && clientId && clientSecret) {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: `${resource}.default`,
      });
      const res = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        { method: "POST", body },
      );
      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text) as { access_token: string };
        return {
          token: parsed.access_token,
          result: {
            check: `${label} — client_credentials token`,
            status: "ok",
            detail: "client_credentials token acquired",
          },
        };
      }
      return {
        token: null,
        result: {
          check: `${label} — client_credentials token`,
          status: "fail",
          detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        },
      };
    } catch (e) {
      return {
        token: null,
        result: {
          check: `${label} — client_credentials token`,
          status: "fail",
          detail: String(e),
        },
      };
    }
  }

  return {
    token: null,
    result: {
      check: `${label} — token`,
      status: "skip",
      detail: "No MI endpoint and no AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET set",
    },
  };
}

async function checkUrl(
  label: string,
  url: string,
  token: string,
  method: "GET" | "POST" = "GET",
  bodyPayload?: unknown,
): Promise<DiagResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
    });
    const text = await res.text();
    if (res.ok) {
      return { check: label, status: "ok", detail: `HTTP ${res.status}` };
    }
    return { check: label, status: "fail", detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { check: label, status: "fail", detail: String(e) };
  }
}

router.get("/noc/diag", requireAuth, requireAdmin, async (_req, res) => {
  const results: DiagResult[] = [];
  const envSnapshot: Record<string, string> = {};

  const envVars = [
    "IDENTITY_ENDPOINT",
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_SUBSCRIPTION_IDS",
    "AZURE_SUBSCRIPTION_LABELS",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_BUDGET_NAME",
    "AZURE_BILLING_ACCOUNT_ID",
    "AZURE_BILLING_PROFILE_ID",
    "AZURE_OPENAI_RESOURCE_ID",
    "AZURE_SEARCH_RESOURCE_ID",
    "APPINSIGHTS_CONNECTION_STRING",
  ];

  for (const v of envVars) {
    envSnapshot[v] = process.env[v] ? "✓ set" : "✗ not set";
  }
  envSnapshot["IDENTITY_HEADER"] = process.env.IDENTITY_HEADER ? "✓ set" : "✗ not set";
  envSnapshot["AZURE_CLIENT_SECRET"] = process.env.AZURE_CLIENT_SECRET ? "✓ set" : "✗ not set";

  const subscriptionIdsRaw = process.env.AZURE_SUBSCRIPTION_IDS ?? process.env.AZURE_SUBSCRIPTION_ID ?? "";
  const subscriptionLabelsRaw = process.env.AZURE_SUBSCRIPTION_LABELS ?? "";
  const subscriptionIds = subscriptionIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const subscriptionLabels = subscriptionLabelsRaw.split(",").map((s) => s.trim());
  const openAiResourceId = process.env.AZURE_OPENAI_RESOURCE_ID;
  const searchResourceId = process.env.AZURE_SEARCH_RESOURCE_ID;
  const billingAccountId = process.env.AZURE_BILLING_ACCOUNT_ID;

  // ── Azure management token ─────────────────────────────────────────────────
  const { token: mgmtToken, result: mgmtTokenResult } = await tryToken(
    "Azure Management",
    "https://management.azure.com/",
  );
  results.push(mgmtTokenResult);

  // ── Cost Management — per subscription ────────────────────────────────────
  if (subscriptionIds.length === 0) {
    results.push({ check: "Cost — subscription query", status: "skip", detail: "AZURE_SUBSCRIPTION_IDS and AZURE_SUBSCRIPTION_ID not set" });
  } else if (!mgmtToken) {
    results.push({ check: "Cost — subscription query", status: "skip", detail: "No token" });
  } else {
    for (let i = 0; i < subscriptionIds.length; i++) {
      const subId = subscriptionIds[i];
      const label = subscriptionLabels[i] ?? subId;
      const costUrl =
        `https://management.azure.com/subscriptions/${subId}` +
        `/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
      results.push(
        await checkUrl(`Cost — ${label} (${subId.slice(0, 8)}…) MTD query`, costUrl, mgmtToken, "POST", {
          type: "ActualCost",
          timeframe: "BillingMonthToDate",
          dataset: { granularity: "None", aggregation: { totalCost: { name: "Cost", function: "Sum" } } },
        }),
      );
    }
  }

  // ── M365 billing account ───────────────────────────────────────────────────
  if (!billingAccountId) {
    results.push({ check: "Cost — M365 billing query", status: "skip", detail: "AZURE_BILLING_ACCOUNT_ID not set" });
  } else if (!mgmtToken) {
    results.push({ check: "Cost — M365 billing query", status: "skip", detail: "No token" });
  } else {
    const billingUrl =
      `https://management.azure.com/providers/Microsoft.Billing/billingAccounts/${billingAccountId}` +
      `/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
    results.push(
      await checkUrl("Cost — M365 billing account query", billingUrl, mgmtToken, "POST", {
        type: "ActualCost",
        timeframe: "BillingMonthToDate",
        dataset: { granularity: "None", aggregation: { totalCost: { name: "Cost", function: "Sum" } } },
      }),
    );
  }

  // ── AI — OpenAI ────────────────────────────────────────────────────────────
  if (!openAiResourceId) {
    results.push({ check: "AI — OpenAI metrics", status: "skip", detail: "AZURE_OPENAI_RESOURCE_ID not set" });
  } else if (!mgmtToken) {
    results.push({ check: "AI — OpenAI metrics", status: "skip", detail: "No token" });
  } else {
    const now = new Date();
    const start = new Date(now.getTime() - 3600 * 1000).toISOString();
    const end = now.toISOString();
    const openAiUrl =
      `https://management.azure.com${openAiResourceId}` +
      `/providers/microsoft.insights/metrics?api-version=2023-10-01` +
      `&metricnames=TokenTransaction&aggregation=Total&interval=PT1H` +
      `&starttime=${start}&endtime=${end}`;
    results.push(await checkUrl("AI — OpenAI TokenTransaction metric", openAiUrl, mgmtToken));
  }

  // ── AI — Search ────────────────────────────────────────────────────────────
  if (!searchResourceId) {
    results.push({ check: "AI — Search metrics", status: "skip", detail: "AZURE_SEARCH_RESOURCE_ID not set" });
  } else if (!mgmtToken) {
    results.push({ check: "AI — Search metrics", status: "skip", detail: "No token" });
  } else {
    const now = new Date();
    const start = new Date(now.getTime() - 3600 * 1000).toISOString();
    const end = now.toISOString();
    const searchUrl =
      `https://management.azure.com${searchResourceId}` +
      `/providers/microsoft.insights/metrics?api-version=2023-10-01` +
      `&metricnames=DocumentCount&aggregation=Average&interval=PT1H` +
      `&starttime=${start}&endtime=${end}`;
    results.push(await checkUrl("AI — Search DocumentCount metric", searchUrl, mgmtToken));
  }

  res.json({ env: envSnapshot, checks: results });
});

export default router;
