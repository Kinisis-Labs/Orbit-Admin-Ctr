import { logger } from "./logger.js";

export type ThirdPartyApiRow = {
  name: string;
  totalCalls: number;
  cost: number;
};

export type ThirdPartyUsageResult = {
  totalCalls: number;
  cost: number;
  costPerMillion: number;
  byApi: ThirdPartyApiRow[];
  source: "live" | "placeholder";
};

// ── Config gates ──────────────────────────────────────────────────────────────

function openAiKey(appId: string): string | undefined {
  const upper = appId.toUpperCase().replace(/-/g, "_");
  return process.env[`OPENAI_API_KEY__${upper}`] ?? process.env["OPENAI_API_KEY"];
}

function replicateToken(appId: string): string | undefined {
  const upper = appId.toUpperCase().replace(/-/g, "_");
  return process.env[`REPLICATE_API_TOKEN__${upper}`] ?? process.env["REPLICATE_API_TOKEN"];
}

export function isOpenAiConfigured(appId: string): boolean {
  return !!openAiKey(appId);
}

export function isReplicateConfigured(appId: string): boolean {
  return !!replicateToken(appId);
}

// ── OpenAI Usage API ──────────────────────────────────────────────────────────
// GET https://api.openai.com/v1/organization/costs
// Returns daily cost buckets for the current month; requires Owners-level key.

async function fetchOpenAiUsage(appId: string): Promise<ThirdPartyApiRow | null> {
  const key = openAiKey(appId);
  if (!key) return null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  // API expects Unix timestamp in seconds
  const startTime = Math.floor(startOfMonth.getTime() / 1000);
  const endTime   = Math.floor(now.getTime() / 1000);

  try {
    const url = `https://api.openai.com/v1/organization/costs?start_time=${startTime}&end_time=${endTime}&limit=100`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ appId, status: resp.status, body: text }, "OpenAI costs API error");
      return null;
    }

    const json = await resp.json() as {
      data?: { results?: { amount?: { value?: number } }[] }[]
    };

    // Sum cost across all buckets
    let totalCostUsd = 0;
    for (const bucket of json.data ?? []) {
      for (const result of bucket.results ?? []) {
        totalCostUsd += result.amount?.value ?? 0;
      }
    }

    // OpenAI doesn't expose call counts in the costs endpoint — use usage endpoint
    const usageUrl = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&end_time=${endTime}&limit=100`;
    const usageResp = await fetch(usageUrl, {
      headers: { Authorization: `Bearer ${key}` },
    });

    let totalRequests = 0;
    if (usageResp.ok) {
      const usageJson = await usageResp.json() as {
        data?: { results?: { num_model_requests?: number }[] }[]
      };
      for (const bucket of usageJson.data ?? []) {
        for (const result of bucket.results ?? []) {
          totalRequests += result.num_model_requests ?? 0;
        }
      }
    }

    return {
      name: "OpenAI",
      totalCalls: totalRequests,
      cost: Number(totalCostUsd.toFixed(4)),
    };
  } catch (err) {
    logger.warn({ appId, err }, "OpenAI usage fetch failed");
    return null;
  }
}

// ── Replicate Billing API ─────────────────────────────────────────────────────
// GET https://api.replicate.com/v1/account/billing/usage
// Returns spend for a date range. Requires API token (user or team).

async function fetchReplicateUsage(appId: string): Promise<ThirdPartyApiRow | null> {
  const token = replicateToken(appId);
  if (!token) return null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startDate = startOfMonth.toISOString().slice(0, 10);
  const endDate   = now.toISOString().slice(0, 10);

  try {
    const url = `https://api.replicate.com/v1/billing/usage?start_date=${startDate}&end_date=${endDate}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ appId, status: resp.status, body: text }, "Replicate billing API error");
      return null;
    }

    const json = await resp.json() as {
      total_cost?: number;
      prediction_count?: number;
      hardware_usage?: { total_cost?: number; prediction_count?: number }[];
    };

    const totalCost  = json.total_cost ?? 0;
    const totalPreds = json.prediction_count ?? 0;

    return {
      name: "Replicate",
      totalCalls: totalPreds,
      cost: Number(totalCost.toFixed(4)),
    };
  } catch (err) {
    logger.warn({ appId, err }, "Replicate usage fetch failed");
    return null;
  }
}

// ── Deterministic placeholder ─────────────────────────────────────────────────
// Used when neither API is configured so the UI always has something to show.

function placeholderUsage(appId: string): ThirdPartyUsageResult {
  if (appId === "grailbabe") {
    const byApi: ThirdPartyApiRow[] = [
      { name: "OpenAI",    totalCalls:  4_820, cost: 12.34 },
      { name: "Replicate", totalCalls:    390, cost:  8.75 },
    ];
    const totalCalls = byApi.reduce((s, r) => s + r.totalCalls, 0);
    const cost       = Number(byApi.reduce((s, r) => s + r.cost, 0).toFixed(2));
    const costPerMillion = Number((cost / (totalCalls / 1_000_000)).toFixed(2));
    return { totalCalls, cost, costPerMillion, byApi, source: "placeholder" };
  }
  return { totalCalls: 0, cost: 0, costPerMillion: 0, byApi: [], source: "placeholder" };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function fetchThirdPartyUsage(appId: string): Promise<ThirdPartyUsageResult> {
  const [openAi, replicate] = await Promise.all([
    fetchOpenAiUsage(appId),
    fetchReplicateUsage(appId),
  ]);

  const rows = [openAi, replicate].filter((r): r is ThirdPartyApiRow => r !== null);

  if (rows.length === 0) {
    return placeholderUsage(appId);
  }

  const totalCalls = rows.reduce((s, r) => s + r.totalCalls, 0);
  const cost       = Number(rows.reduce((s, r) => s + r.cost, 0).toFixed(4));
  const costPerMillion = totalCalls > 0
    ? Number((cost / (totalCalls / 1_000_000)).toFixed(2))
    : 0;

  return {
    totalCalls,
    cost,
    costPerMillion,
    byApi: rows,
    source: "live",
  };
}
