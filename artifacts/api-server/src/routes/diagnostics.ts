import { Router } from "express";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import {
  getAzureCredential,
  getSubscriptionIds,
  isAzureConfigured,
} from "../lib/azure.js";
import { normalizeResourceGraphRows, getSharedInfraSubscriptionId } from "../lib/azureNetwork.js";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middlewares/auth.js";

const router = Router();

type CheckResult =
  | { status: "ok"; detail?: string }
  | { status: "not_configured"; detail: string }
  | { status: "error"; detail: string };

async function checkAzureCredential(): Promise<CheckResult> {
  if (!isAzureConfigured()) {
    return { status: "not_configured", detail: "AZURE_SUBSCRIPTION_IDS not set" };
  }
  const subs = getSubscriptionIds();
  try {
    const client = new ResourceGraphClient(getAzureCredential());
    await client.resources({
      subscriptions: subs.slice(0, 1),
      query: "Resources | limit 1 | project id",
    });
    return { status: "ok", detail: `Queried ${subs.length} subscription(s) via Resource Graph` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", detail: msg };
  }
}

async function checkGitHubToken(): Promise<CheckResult> {
  const token = process.env.GITHUB_TOKEN ?? process.env.ORBIT_DEPLOY_ID;
  if (!token) return { status: "not_configured", detail: "GITHUB_TOKEN / ORBIT_DEPLOY_ID not set" };
  try {
    // Use the Actions runs endpoint — the PAT is fine-grained with Actions: Read
    // (not repo metadata read), so hitting /repos/{org}/{repo} returns 403.
    const res = await fetch(
      "https://api.github.com/repos/Kinisis-Labs/Orbit-Admin-Ctr/actions/runs?per_page=1",
      { headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } },
    );
    if (res.status === 401 || res.status === 403) {
      return { status: "error", detail: `GitHub returned ${res.status} — token invalid or missing Actions:Read permission` };
    }
    if (!res.ok) {
      return { status: "error", detail: `GitHub returned ${res.status}` };
    }
    const body = (await res.json()) as { total_count?: number };
    return { status: "ok", detail: `Token valid — ${body.total_count ?? "?"} workflow runs accessible` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", detail: msg };
  }
}

function envVar(name: string): string {
  const val = process.env[name];
  if (!val) return "❌ not set";
  if (name.toLowerCase().includes("secret") || name.toLowerCase().includes("password")) {
    return `✓ set (${val.length} chars)`;
  }
  return `✓ ${val.length > 80 ? val.slice(0, 80) + "…" : val}`;
}

function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Check per-app subscription GUID configuration. */
function checkSubscriptionConfig(): Record<string, string> {
  const subIds = getSubscriptionIds();
  const apps: Record<string, string> = {};

  const appVars: Array<{ appId: string; envKey: string }> = [
    { appId: "grailbabe", envKey: "AZURE_SUB_GRAILBABE" },
    { appId: "kinisis-labs", envKey: "AZURE_SUB_KINISIS_LABS" },
  ];

  for (const { appId, envKey } of appVars) {
    const val = process.env[envKey];
    if (!val) {
      apps[appId] = `⚠️  ${envKey} not set — subscription resolved via Resource Graph (only searches AZURE_SUBSCRIPTION_IDS)`;
      continue;
    }
    if (!isGuid(val)) {
      apps[appId] = `❌ ${envKey}="${val}" is not a valid GUID — cost queries will fall back to Resource Graph lookup`;
      continue;
    }
    const inMainList = subIds.includes(val);
    apps[appId] = inMainList
      ? `✓ ${val} (also in AZURE_SUBSCRIPTION_IDS)`
      : `✓ ${val} — not in AZURE_SUBSCRIPTION_IDS (cost queries work; Resource Graph queries may miss this sub)`;
  }

  return apps;
}

/** Probe the Resource Graph network query — shows what resources were found (or why it failed). */
async function checkNetworkResourceGraph(): Promise<CheckResult> {
  if (!isAzureConfigured()) {
    return { status: "not_configured", detail: "AZURE_SUBSCRIPTION_IDS not set" };
  }

  // Mirror the exact subscription-list logic used by fetchNetworkEndpoints so diagnostics
  // reflect the real query: global subs + AZURE_SUB_SHAREDPLATFORM (if set and valid).
  const globalSubs = getSubscriptionIds();
  const sharedInfraSub = getSharedInfraSubscriptionId();
  const subs = [...new Set([...globalSubs, ...(sharedInfraSub ? [sharedInfraSub] : [])])];

  logger.info(
    { subscriptions: subs, sharedInfraIncluded: !!sharedInfraSub },
    "checkNetworkResourceGraph querying subscriptions",
  );

  try {
    const client = new ResourceGraphClient(getAzureCredential());
    const result = await client.resources({
      subscriptions: subs,
      query: `
        resources
        | where type in~ (
            'microsoft.app/containerapps',
            'microsoft.app/managedenvironments',
            'microsoft.network/frontdoors',
            'microsoft.cdn/profiles',
            'microsoft.network/applicationgateways',
            'microsoft.network/networksecuritygroups',
            'microsoft.network/publicipaddresses',
            'microsoft.network/loadbalancers',
            'microsoft.network/networkwatchers',
            'microsoft.network/privatednszones',
            'microsoft.network/dnszones'
          )
        | project id, name, type, resourceGroup, location
        | order by type asc
        | limit 100
      `,
    });
    const rows = normalizeResourceGraphRows(result.data);
    const subsDetail = `queried ${subs.length} subscription(s): ${subs.join(", ")}` +
      (sharedInfraSub ? ` (includes AZURE_SUB_SHAREDPLATFORM)` : "");
    if (rows.length === 0) {
      return {
        status: "ok",
        detail: `Query succeeded but found 0 networking resources — ${subsDetail}. ` +
          `Verify that Container Apps / Front Door / Network Watchers exist in those subscriptions. ` +
          `If shared-platform resources are missing, set AZURE_SUB_SHAREDPLATFORM to the sub-sharedplatform GUID.`,
      };
    }
    const summary = rows.map((r) => `${r["type"]}/${r["name"]} (${r["resourceGroup"]}, ${r["location"]})`).join("; ");
    return { status: "ok", detail: `Found ${rows.length} resource(s) [${subsDetail}]: ${summary}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError = msg.includes("AuthorizationFailed") || msg.includes("does not have authorization");
    logger.error(
      { err, subscriptions: subs },
      "checkNetworkResourceGraph Resource Graph query failed",
    );
    const sharedInfraHint = sharedInfraSub && !globalSubs.includes(sharedInfraSub)
      ? ` — note: ${sharedInfraSub} is the AZURE_SUB_SHAREDPLATFORM sub (sub-sharedplatform); grant Reader there too`
      : "";
    return {
      status: "error",
      detail: isAuthError
        ? `Missing 'Reader' role on subscription(s) ${subs.join(", ")} for managed identity id-orbit-api-prod${sharedInfraHint}`
        : `Resource Graph error (queried subs: ${subs.join(", ")}): ${msg}`,
    };
  }
}

/** Probe Cost Management Reader access on each configured subscription. */
async function checkCostManagementAccess(): Promise<Record<string, CheckResult>> {
  if (!isAzureConfigured()) {
    return { _: { status: "not_configured", detail: "AZURE_SUBSCRIPTION_IDS not set" } };
  }

  const appSubs: Array<{ label: string; subId: string }> = [
    { label: "grailbabe", subId: process.env.AZURE_SUB_GRAILBABE ?? "" },
    { label: "orbit", subId: process.env.AZURE_SUB_ORBIT ?? "" },
    { label: "kinisis-labs", subId: process.env.AZURE_SUB_KINISIS_LABS ?? "" },
  ].filter((a) => isGuid(a.subId));

  const client = new CostManagementClient(getAzureCredential());
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);

  const results: Record<string, CheckResult> = {};

  await Promise.all(
    appSubs.map(async ({ label, subId }) => {
      try {
        await client.query.usage(`/subscriptions/${subId}`, {
          type: "Usage",
          timeframe: "Custom",
          timePeriod: { from, to: now },
          dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
          },
        });
        results[label] = { status: "ok", detail: `Cost Management Reader confirmed on ${subId}` };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthError = msg.includes("AuthorizationFailed") || msg.includes("does not have authorization");
        results[label] = {
          status: "error",
          detail: isAuthError
            ? `Missing 'Cost Management Reader' role on subscription ${subId} for managed identity id-orbit-api-prod`
            : msg,
        };
      }
    }),
  );

  return results;
}

router.get("/diagnostics", requireAdmin, async (_req, res) => {
  logger.info("diagnostics endpoint called");

  const [azureCheck, githubCheck, costCheck, networkCheck] = await Promise.all([
    checkAzureCredential(),
    checkGitHubToken(),
    checkCostManagementAccess(),
    checkNetworkResourceGraph(),
  ]);

  const report = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: envVar("NODE_ENV"),
      AZURE_SUBSCRIPTION_IDS: envVar("AZURE_SUBSCRIPTION_IDS"),
      AZURE_CLIENT_ID: envVar("AZURE_CLIENT_ID"),
      AZURE_TENANT_ID: envVar("AZURE_TENANT_ID"),
      AZURE_LOG_ANALYTICS_WORKSPACE_ID: envVar("AZURE_LOG_ANALYTICS_WORKSPACE_ID"),
      AZURE_SUB_GRAILBABE: envVar("AZURE_SUB_GRAILBABE"),
      AZURE_SUB_ORBIT: envVar("AZURE_SUB_ORBIT"),
      AZURE_SUB_KINISIS_LABS: envVar("AZURE_SUB_KINISIS_LABS"),
      AZURE_SUB_SHAREDPLATFORM: envVar("AZURE_SUB_SHAREDPLATFORM"),
      ENTRA_TENANT_ID: envVar("ENTRA_TENANT_ID"),
      ENTRA_CLIENT_ID: envVar("ENTRA_CLIENT_ID"),
      ENTRA_CLIENT_SECRET: envVar("ENTRA_CLIENT_SECRET"),
      ENTRA_REDIRECT_URI: envVar("ENTRA_REDIRECT_URI"),
      ENTRA_AUTHORIZED_GROUP_ID: envVar("ENTRA_AUTHORIZED_GROUP_ID"),
      ENTRA_COST_READER_GROUP_ID: envVar("ENTRA_COST_READER_GROUP_ID"),
      GITHUB_TOKEN: (process.env.GITHUB_TOKEN ?? process.env.ORBIT_DEPLOY_ID)
        ? `✓ set via ${process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "ORBIT_DEPLOY_ID"} (${(process.env.GITHUB_TOKEN ?? process.env.ORBIT_DEPLOY_ID)!.length} chars)`
        : "❌ not set (checked GITHUB_TOKEN + ORBIT_DEPLOY_ID)",
      SESSION_SECRET: process.env.SESSION_SECRET ? `✓ set (${process.env.SESSION_SECRET.length} chars)` : "❌ not set",
      DATABASE_URL: process.env.DATABASE_URL ? "✓ set" : "❌ not set",
      DATABASE_SSL: envVar("DATABASE_SSL"),
      // Container Apps managed-identity runtime injection — set by the platform
      // when a managed identity is attached; absent = identity not attached/effective
      IDENTITY_ENDPOINT: envVar("IDENTITY_ENDPOINT"),
      IDENTITY_HEADER: process.env.IDENTITY_HEADER ? "✓ set" : "❌ not set",
      MSI_ENDPOINT: envVar("MSI_ENDPOINT"),
    },
    warnings: {
      azure_client_id_matches_entra_client_id:
        process.env.AZURE_CLIENT_ID &&
        process.env.ENTRA_CLIENT_ID &&
        process.env.AZURE_CLIENT_ID === process.env.ENTRA_CLIENT_ID
          ? "⚠️  AZURE_CLIENT_ID equals ENTRA_CLIENT_ID — AZURE_MANAGED_IDENTITY_CLIENT_ID secret is probably set to the Entra app registration ID instead of the managed identity id-orbit-api-prod client ID"
          : "ok",
    },
    checks: {
      azure_resource_graph: azureCheck,
      github_token: githubCheck,
      cost_management_access: costCheck,
      network_resource_graph: networkCheck,
    },
    subscription_config: checkSubscriptionConfig(),
  };

  res.json(report);
});

export default router;

