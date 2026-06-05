import { Router } from "express";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import {
  getAzureCredential,
  getSubscriptionIds,
  isAzureConfigured,
} from "../lib/azure.js";
import { logger } from "../lib/logger.js";

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
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { status: "not_configured", detail: "GITHUB_TOKEN not set" };
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

router.get("/diagnostics", async (_req, res) => {
  logger.info("diagnostics endpoint called");

  const [azureCheck, githubCheck] = await Promise.all([
    checkAzureCredential(),
    checkGitHubToken(),
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
      ENTRA_TENANT_ID: envVar("ENTRA_TENANT_ID"),
      ENTRA_CLIENT_ID: envVar("ENTRA_CLIENT_ID"),
      ENTRA_CLIENT_SECRET: envVar("ENTRA_CLIENT_SECRET"),
      ENTRA_REDIRECT_URI: envVar("ENTRA_REDIRECT_URI"),
      ENTRA_AUTHORIZED_GROUP_ID: envVar("ENTRA_AUTHORIZED_GROUP_ID"),
      ENTRA_COST_READER_GROUP_ID: envVar("ENTRA_COST_READER_GROUP_ID"),
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ? `✓ set (${process.env.GITHUB_TOKEN.length} chars)` : "❌ not set",
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
    },
  };

  res.json(report);
});

export default router;

