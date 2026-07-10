/**
 * Azure Cost Management client.
 *
 * Uses the Azure Cost Management Query API to fetch actual spend, budget
 * utilisation, and top cost contributors for the subscription.
 *
 * Also queries the Billing Account scope for Microsoft 365 / license costs
 * when AZURE_BILLING_ACCOUNT_ID is set.
 *
 * Auth: Managed Identity (IDENTITY_ENDPOINT + IDENTITY_HEADER) or
 *       client_credentials (AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET).
 *
 * Required env vars:
 *   AZURE_SUBSCRIPTION_IDS     — comma-separated subscription IDs (e.g. "abc-123,def-456")
 *   AZURE_SUBSCRIPTION_LABELS  — comma-separated display names matching the IDs above
 *                                (e.g. "SharedPlatform,GrailBabe")
 *   AZURE_SUBSCRIPTION_ID      — single subscription fallback (used if IDS not set)
 *   AZURE_BUDGET_NAME          — (optional) named budget to read utilisation from
 *   AZURE_BILLING_ACCOUNT_ID   — (optional) EA/MCA billing account for M365 costs
 *   AZURE_BILLING_PROFILE_ID   — (optional) MCA billing profile scope (MCA only)
 */

export interface CostByService {
  serviceName: string;
  cost: number;
  currency: string;
}

export interface BudgetInfo {
  name: string;
  limit: number;
  currentSpend: number;
  currency: string;
  utilizationPct: number;
  forecastedSpend: number | null;
}

export interface M365Invoice {
  invoiceId: string;
  billingPeriod: string;
  dueDate: string | null;
  amount: number;
  currency: string;
  status: string;
  downloadUrl: string | null;
}

export interface M365CostSummary {
  latestInvoiceAmount: number | null;
  ytdTotal: number | null;
  currency: string;
  invoices: M365Invoice[];
  billingConfigured: boolean;
}

export interface SubscriptionCost {
  subscriptionId: string;
  label: string;
  totalMtdCost: number | null;
  totalYtdCost: number | null;
  currency: string;
  topServices: CostByService[];
  budget: BudgetInfo | null;
}

export interface CostSnapshot {
  subscriptions: SubscriptionCost[];
  subscriptionConfigured: boolean;
  m365: M365CostSummary;
  capturedAt: string;
}

// ── Token ─────────────────────────────────────────────────────────────────────

async function getAzureToken(): Promise<string | null> {
  const resource = "https://management.azure.com/";
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

    const { AZURE_TENANT_ID: tenantId, AZURE_CLIENT_ID: clientId, AZURE_CLIENT_SECRET: clientSecret } =
      process.env;
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

async function getSpToken(): Promise<string | null> {
  const resource = "https://management.azure.com/";
  const { AZURE_TENANT_ID: tenantId, AZURE_CLIENT_ID: clientId, AZURE_CLIENT_SECRET: clientSecret } = process.env;
  if (!tenantId || !clientId || !clientSecret) return null;
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${resource}.default`,
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      body,
    });
    if (res.ok) {
      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

export function isCostConfigured(): boolean {
  return !!(process.env.AZURE_SUBSCRIPTION_IDS ?? process.env.AZURE_SUBSCRIPTION_ID);
}

function getSubscriptionList(): Array<{ id: string; label: string }> {
  const ids = process.env.AZURE_SUBSCRIPTION_IDS
    ? process.env.AZURE_SUBSCRIPTION_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : process.env.AZURE_SUBSCRIPTION_ID
      ? [process.env.AZURE_SUBSCRIPTION_ID.trim()]
      : [];

  const labels = process.env.AZURE_SUBSCRIPTION_LABELS
    ? process.env.AZURE_SUBSCRIPTION_LABELS.split(",").map((s) => s.trim())
    : [];

  return ids.map((id, i) => ({ id, label: labels[i] ?? id }));
}

// ── Cost query helper ─────────────────────────────────────────────────────────

type QueryBody = {
  type: string;
  timeframe: string;
  timePeriod?: { from: string; to: string };
  dataset: {
    granularity: string;
    aggregation: Record<string, { name: string; function: string }>;
    grouping?: Array<{ type: string; name: string }>;
  };
};

interface CostRow {
  properties: {
    rows: Array<Array<string | number>>;
    columns: Array<{ name: string; type: string }>;
  };
}

async function queryCosts(
  token: string,
  scopePath: string,
  body: QueryBody,
): Promise<CostRow | null> {
  try {
    const url =
      `https://management.azure.com${scopePath}` +
      `/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as CostRow;
  } catch {
    return null;
  }
}

function subscriptionScope(subscriptionId: string): string {
  return `/subscriptions/${subscriptionId}`;
}

function billingScope(): string | null {
  const billingAccountId = process.env.AZURE_BILLING_ACCOUNT_ID;
  if (!billingAccountId) return null;
  const profileId = process.env.AZURE_BILLING_PROFILE_ID;
  if (profileId) {
    return `/providers/Microsoft.Billing/billingAccounts/${billingAccountId}/billingProfiles/${profileId}`;
  }
  return `/providers/Microsoft.Billing/billingAccounts/${billingAccountId}`;
}

export function isBillingConfigured(): boolean {
  return !!process.env.AZURE_BILLING_ACCOUNT_ID;
}

// ── MTD total ─────────────────────────────────────────────────────────────────

async function getMtdCost(
  token: string,
  subscriptionId: string,
): Promise<{ total: number | null; currency: string }> {
  const result = await queryCosts(token, subscriptionScope(subscriptionId), {
    type: "ActualCost",
    timeframe: "BillingMonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
    },
  });

  const rows = result?.properties?.rows ?? [];
  if (rows.length === 0) return { total: null, currency: "USD" };
  const [cost, , currency] = rows[0] as [number, unknown, string];
  return { total: cost, currency: currency ?? "USD" };
}

// ── YTD total ─────────────────────────────────────────────────────────────────

async function getYtdCost(token: string, subscriptionId: string): Promise<number | null> {
  const now = new Date();
  const ytdStart = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0]!;
  const today = now.toISOString().split("T")[0]!;

  const result = await queryCosts(token, subscriptionScope(subscriptionId), {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: ytdStart, to: today },
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
    },
  });

  const rows = result?.properties?.rows ?? [];
  if (rows.length === 0) return null;
  return (rows[0] as [number])[0] ?? null;
}

// ── Top services ──────────────────────────────────────────────────────────────

async function getTopServices(
  token: string,
  subscriptionId: string,
  currency: string,
): Promise<CostByService[]> {
  const result = await queryCosts(token, subscriptionScope(subscriptionId), {
    type: "ActualCost",
    timeframe: "BillingMonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }],
    },
  });

  const rows = result?.properties?.rows ?? [];
  return rows
    .map((r) => ({
      serviceName: String((r as [number, string])[1] ?? "Unknown"),
      cost: Number((r as [number])[0] ?? 0),
      currency,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
}

// ── M365 / Billing Account costs via MCA Invoices API ───────────────────────

interface InvoiceResponse {
  value?: Array<{
    name?: string;
    properties?: {
      invoiceDate?: string;
      dueDate?: string;
      amountDue?: { value?: number; currency?: string };
      totalAmount?: { value?: number; currency?: string };
      status?: string;
      invoicePeriodStartDate?: string;
      invoicePeriodEndDate?: string;
      documents?: Array<{ documentType?: string; url?: string }>;
    };
  }>;
}

async function getM365Costs(token: string): Promise<M365CostSummary> {
  const empty: M365CostSummary = {
    latestInvoiceAmount: null,
    ytdTotal: null,
    currency: "USD",
    invoices: [],
    billingConfigured: isBillingConfigured(),
  };

  const billingAccountId = process.env.AZURE_BILLING_ACCOUNT_ID;
  if (!billingAccountId) return empty;

  try {
    const currentYear = new Date().getFullYear();
    const url =
      `https://management.azure.com/providers/Microsoft.Billing/billingAccounts/${billingAccountId}` +
      `/invoices?api-version=2020-05-01&periodStartDate=${currentYear}-01-01&periodEndDate=${currentYear}-12-31`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return empty;

    const data = (await res.json()) as InvoiceResponse;
    const items = data.value ?? [];

    const invoices: M365Invoice[] = items
      .map((item) => {
        const p = item.properties ?? {};
        const amt = p.amountDue ?? p.totalAmount;
        const doc = (p.documents ?? []).find((d) => d.documentType === "Invoice");
        return {
          invoiceId: item.name ?? "",
          billingPeriod: p.invoicePeriodStartDate
            ? `${p.invoicePeriodStartDate} – ${p.invoicePeriodEndDate ?? ""}`
            : "",
          dueDate: p.dueDate ?? null,
          amount: amt?.value ?? 0,
          currency: amt?.currency ?? "USD",
          status: p.status ?? "Unknown",
          downloadUrl: doc?.url ?? null,
        };
      })
      .filter((inv) => inv.amount > 0)
      .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? ""));

    const currency = invoices[0]?.currency ?? "USD";
    const latestInvoiceAmount = invoices[0]?.amount ?? null;
    const ytdTotal = invoices.reduce((sum, inv) => sum + inv.amount, 0) || null;

    return { latestInvoiceAmount, ytdTotal, currency, invoices, billingConfigured: true };
  } catch {
    return empty;
  }
}

// ── Budget ────────────────────────────────────────────────────────────────────

interface BudgetResponse {
  properties?: {
    amount?: number;
    currentSpend?: { amount?: number; unit?: string };
    forecastSpend?: { amount?: number };
  };
}

async function getBudget(token: string, subscriptionId: string): Promise<BudgetInfo | null> {
  const budgetName = process.env.AZURE_BUDGET_NAME;
  if (!budgetName) return null;

  try {
    const url =
      `https://management.azure.com/subscriptions/${subscriptionId}` +
      `/providers/Microsoft.Consumption/budgets/${encodeURIComponent(budgetName)}?api-version=2023-05-01`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;

    const data = (await res.json()) as BudgetResponse;
    const limit = data.properties?.amount ?? 0;
    const currentSpend = data.properties?.currentSpend?.amount ?? 0;
    const currency = data.properties?.currentSpend?.unit ?? "USD";
    const forecastedSpend = data.properties?.forecastSpend?.amount ?? null;
    const utilizationPct = limit > 0 ? (currentSpend / limit) * 100 : 0;

    return { name: budgetName, limit, currentSpend, currency, utilizationPct, forecastedSpend };
  } catch {
    return null;
  }
}

// ── Per-subscription query ────────────────────────────────────────────────────

async function getSubscriptionCost(
  token: string,
  id: string,
  label: string,
): Promise<SubscriptionCost> {
  const { total: totalMtdCost, currency } = await getMtdCost(token, id);
  const [totalYtdCost, topServices, budget] = await Promise.all([
    getYtdCost(token, id),
    getTopServices(token, id, currency),
    getBudget(token, id),
  ]);
  return { subscriptionId: id, label, totalMtdCost, totalYtdCost, currency, topServices, budget };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getCostSnapshot(): Promise<CostSnapshot> {
  const capturedAt = new Date().toISOString();
  const subList = getSubscriptionList();

  const emptyM365: M365CostSummary = {
    latestInvoiceAmount: null,
    ytdTotal: null,
    currency: "USD",
    invoices: [],
    billingConfigured: isBillingConfigured(),
  };

  if (subList.length === 0) {
    return { subscriptions: [], subscriptionConfigured: false, m365: emptyM365, capturedAt };
  }

  const [miToken, spToken] = await Promise.all([getAzureToken(), getSpToken()]);
  const token = miToken ?? spToken;
  if (!token) {
    return { subscriptions: [], subscriptionConfigured: true, m365: emptyM365, capturedAt };
  }

  const billingToken = spToken ?? miToken;

  const [subscriptions, m365] = await Promise.all([
    Promise.all(subList.map(({ id, label }) => getSubscriptionCost(token, id, label))),
    billingToken ? getM365Costs(billingToken) : Promise.resolve(emptyM365),
  ]);

  return { subscriptions, subscriptionConfigured: true, m365, capturedAt };
}
