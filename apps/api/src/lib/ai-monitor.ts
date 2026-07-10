/**
 * AI Platform Monitor
 *
 * Queries:
 *  - Azure OpenAI: token usage, latency, error rate via Azure Monitor REST API
 *  - Azure AI Search: document count, query latency, throttled queries via Azure Monitor REST API
 *
 * Auth: reuses the same Managed Identity / client_credentials token flow as azure-monitor.ts
 */

export interface OpenAiMetrics {
  tokenUsage: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  avgLatencyMs: number | null;
  errorRate: number | null;
  totalRequests: number | null;
}

export interface AiSearchMetrics {
  documentCount: number | null;
  queryLatencyMs: number | null;
  throttledQueryPct: number | null;
  totalQueries: number | null;
}

export interface AiSnapshot {
  openAi: OpenAiMetrics;
  aiSearch: AiSearchMetrics;
  openAiConfigured: boolean;
  aiSearchConfigured: boolean;
  capturedAt: string;
}

// ── Token acquisition (mirrors azure-monitor.ts) ──────────────────────────────

async function getAzureToken(resource = "https://management.azure.com/"): Promise<string | null> {
  try {
    const miEndpoint = process.env.IDENTITY_ENDPOINT;
    const miHeader = process.env.IDENTITY_HEADER;

    if (miEndpoint && miHeader) {
      const res = await fetch(
        `${miEndpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`,
        { headers: { "X-IDENTITY-HEADER": miHeader } },
      );
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (tenantId && clientId && clientSecret) {
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
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Azure Monitor metric helper ───────────────────────────────────────────────

interface MonitorValue {
  average?: number;
  total?: number;
  count?: number;
}

async function getMonitorMetric(
  token: string,
  resourceId: string,
  metricName: string,
  aggregation: "Average" | "Total" | "Count",
  timespan = "PT24H",
): Promise<number | null> {
  try {
    const url =
      `https://management.azure.com${resourceId}/providers/microsoft.insights/metrics` +
      `?api-version=2019-07-01&metricnames=${encodeURIComponent(metricName)}` +
      `&aggregation=${aggregation}&timespan=${timespan}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    type MetricResponse = {
      value?: Array<{
        timeseries?: Array<{ data?: MonitorValue[] }>;
      }>;
    };

    const data = (await res.json()) as MetricResponse;
    const points = data.value?.[0]?.timeseries?.[0]?.data ?? [];
    const nonNull = points.filter(
      (p) => p.average !== undefined || p.total !== undefined || p.count !== undefined,
    );
    if (nonNull.length === 0) return null;

    const key = aggregation.toLowerCase() as keyof MonitorValue;
    const values = nonNull.map((p) => (p[key] as number | undefined) ?? 0);
    return aggregation === "Average"
      ? values.reduce((a, b) => a + b, 0) / values.length
      : values.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

// ── OpenAI metrics ────────────────────────────────────────────────────────────

export function isOpenAiConfigured(): boolean {
  return !!process.env.AZURE_OPENAI_RESOURCE_ID;
}

async function getOpenAiMetrics(token: string): Promise<OpenAiMetrics> {
  const resourceId = process.env.AZURE_OPENAI_RESOURCE_ID;
  if (!resourceId) {
    return {
      tokenUsage: null,
      promptTokens: null,
      completionTokens: null,
      avgLatencyMs: null,
      errorRate: null,
      totalRequests: null,
    };
  }

  const [tokenUsage, promptTokens, completionTokens, avgLatency, errors, total] =
    await Promise.all([
      getMonitorMetric(token, resourceId, "TokenTransaction", "Total"),
      getMonitorMetric(token, resourceId, "PromptTokenTransaction", "Total"),
      getMonitorMetric(token, resourceId, "GeneratedTokenTransaction", "Total"),
      getMonitorMetric(token, resourceId, "AzureOpenAIRequests", "Average"),
      getMonitorMetric(token, resourceId, "AzureOpenAIServerErrors", "Total"),
      getMonitorMetric(token, resourceId, "AzureOpenAIRequests", "Total"),
    ]);

  const errorRate =
    errors !== null && total !== null && total > 0
      ? (errors / total) * 100
      : null;

  return {
    tokenUsage,
    promptTokens,
    completionTokens,
    avgLatencyMs: avgLatency,
    errorRate,
    totalRequests: total,
  };
}

// ── AI Search metrics ─────────────────────────────────────────────────────────

export function isAiSearchConfigured(): boolean {
  return !!process.env.AZURE_SEARCH_RESOURCE_ID;
}

async function getAiSearchMetrics(token: string): Promise<AiSearchMetrics> {
  const resourceId = process.env.AZURE_SEARCH_RESOURCE_ID;
  if (!resourceId) {
    return {
      documentCount: null,
      queryLatencyMs: null,
      throttledQueryPct: null,
      totalQueries: null,
    };
  }

  const [docCount, latency, throttled, queries] = await Promise.all([
    getMonitorMetric(token, resourceId, "DocumentCount", "Average"),
    getMonitorMetric(token, resourceId, "SearchLatency", "Average"),
    getMonitorMetric(token, resourceId, "ThrottledSearchQueriesPercentage", "Average"),
    getMonitorMetric(token, resourceId, "SearchQueriesPerSecond", "Total"),
  ]);

  return {
    documentCount: docCount,
    queryLatencyMs: latency !== null ? latency * 1000 : null,
    throttledQueryPct: throttled,
    totalQueries: queries,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getAiSnapshot(): Promise<AiSnapshot> {
  const capturedAt = new Date().toISOString();
  const token = await getAzureToken();

  const [openAi, aiSearch] = await Promise.all([
    token ? getOpenAiMetrics(token) : Promise.resolve({
      tokenUsage: null, promptTokens: null, completionTokens: null,
      avgLatencyMs: null, errorRate: null, totalRequests: null,
    }),
    token ? getAiSearchMetrics(token) : Promise.resolve({
      documentCount: null, queryLatencyMs: null,
      throttledQueryPct: null, totalQueries: null,
    }),
  ]);

  return {
    openAi,
    aiSearch,
    openAiConfigured: isOpenAiConfigured(),
    aiSearchConfigured: isAiSearchConfigured(),
    capturedAt,
  };
}
