import { RefreshCw, Loader2, Info, DollarSign, TrendingUp, Package, CloudCog, ExternalLink } from "lucide-react";
import {
  useCostMetrics,
  type CostByService,
  type BudgetInfo,
  type SubscriptionCost,
  type M365Invoice,
  type M365CostSummary,
} from "../../services/noc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(value: number | null, currency: string): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function SummaryTile({
  label,
  value,
  currency,
  subtext,
  highlight,
}: {
  label: string;
  value: number | null;
  currency: string;
  subtext?: string;
  highlight?: "red" | "yellow";
}) {
  let color = "var(--orbit-text-primary)";
  if (value !== null && highlight === "red") color = "#ef4444";
  else if (value !== null && highlight === "yellow") color = "#f59e0b";

  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-1"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--orbit-text-muted)" }}>
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {fmtCurrency(value, currency)}
      </span>
      {subtext && (
        <span className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
          {subtext}
        </span>
      )}
    </div>
  );
}

function BudgetBar({ budget }: { budget: BudgetInfo }) {
  const pct = Math.min(budget.utilizationPct, 100);
  const barColor =
    pct >= 90 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#22c55e";

  return (
    <div
      className="rounded-xl px-5 py-4 space-y-3"
      style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
          Budget · {budget.name}
        </span>
        <span className="text-sm font-bold tabular-nums" style={{ color: barColor }}>
          {budget.utilizationPct.toFixed(1)}%
        </span>
      </div>
      <div className="w-full rounded-full h-2" style={{ background: "var(--orbit-border)" }}>
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--orbit-text-muted)" }}>
        <span>
          Spent: {fmtCurrency(budget.currentSpend, budget.currency)}
        </span>
        <span>
          Limit: {fmtCurrency(budget.limit, budget.currency)}
        </span>
        {budget.forecastedSpend !== null && (
          <span>
            Forecast: {fmtCurrency(budget.forecastedSpend, budget.currency)}
          </span>
        )}
      </div>
    </div>
  );
}

function ServiceRow({ service, maxCost }: { service: CostByService; maxCost: number }) {
  const pct = maxCost > 0 ? (service.cost / maxCost) * 100 : 0;
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
        {service.serviceName}
      </td>
      <td className="px-4 py-3" style={{ width: "40%" }}>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-full h-1.5" style={{ background: "var(--orbit-border)" }}>
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${pct}%`, background: "var(--orbit-accent, #6366f1)" }}
            />
          </div>
          <span className="text-xs tabular-nums w-16 text-right" style={{ color: "var(--orbit-text-muted)" }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-right" style={{ color: "var(--orbit-text-primary)" }}>
        {fmtCurrency(service.cost, service.currency)}
      </td>
    </tr>
  );
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  const color =
    s === "paid" ? "#22c55e" : s === "due" || s === "pastdue" ? "#ef4444" : "#f59e0b";
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: `${color}22`, color }}
    >
      {status}
    </span>
  );
}

function M365InvoiceRow({ invoice }: { invoice: M365Invoice }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-secondary)" }}>
        {invoice.invoiceId}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-muted)" }}>
        {invoice.billingPeriod}
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--orbit-text-muted)" }}>
        {invoice.dueDate ?? "—"}
      </td>
      <td className="px-4 py-3">{statusBadge(invoice.status)}</td>
      <td
        className="px-4 py-3 text-sm tabular-nums text-right"
        style={{ color: "var(--orbit-text-primary)" }}
      >
        {fmtCurrency(invoice.amount, invoice.currency)}
      </td>
      <td className="px-4 py-3 text-right">
        {invoice.downloadUrl ? (
          <a
            href={invoice.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: "#0ea5e9" }}
          >
            <ExternalLink className="h-3 w-3" />
            PDF
          </a>
        ) : null}
      </td>
    </tr>
  );
}

function M365Section({ m365 }: { m365: M365CostSummary }) {
  return (
    <>
      <div className="flex items-center gap-2 mt-2">
        <Package className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
          Microsoft 365 Billing Invoices
        </h2>
        <div className="flex-1 h-px" style={{ background: "var(--orbit-border)" }} />
      </div>

      {!m365.billingConfigured ? (
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.3)",
            color: "#f59e0b",
          }}
        >
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Billing account not configured — set{" "}
            <code className="font-mono text-xs">AZURE_BILLING_ACCOUNT_ID</code> to enable MCA invoice
            history.
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <SummaryTile
              label="Latest Invoice"
              value={m365.latestInvoiceAmount}
              currency={m365.currency}
              subtext="most recent billing period"
            />
            <SummaryTile
              label="Year-to-Date Total"
              value={m365.ytdTotal}
              currency={m365.currency}
              subtext="sum of all invoices this year"
            />
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
          >
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid var(--orbit-border)" }}
            >
              <Package className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
                Invoice History ({new Date().getFullYear()})
              </span>
              <span className="ml-auto text-xs" style={{ color: "var(--orbit-text-muted)" }}>
                {m365.invoices.length} invoices
              </span>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
                  {["Invoice", "Billing Period", "Due Date", "Status", "Amount", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left text-xs font-semibold"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m365.invoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-sm text-center"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      No invoices found for this billing account this year.
                    </td>
                  </tr>
                ) : (
                  m365.invoices.map((inv) => (
                    <M365InvoiceRow key={inv.invoiceId} invoice={inv} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function SubscriptionSection({ sub }: { sub: SubscriptionCost }) {
  const maxCost = sub.topServices[0]?.cost ?? 1;
  return (
    <>
      <div className="flex items-center gap-2 mt-1">
        <CloudCog className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
          {sub.label}
        </h2>
        <span className="text-xs font-mono" style={{ color: "var(--orbit-text-muted)" }}>
          {sub.subscriptionId}
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--orbit-border)" }} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SummaryTile
          label="Month-to-Date"
          value={sub.totalMtdCost}
          currency={sub.currency}
          subtext="current billing month"
          highlight={
            sub.budget && sub.totalMtdCost !== null && sub.totalMtdCost / sub.budget.limit > 0.9
              ? "red"
              : sub.budget && sub.totalMtdCost !== null && sub.totalMtdCost / sub.budget.limit > 0.75
                ? "yellow"
                : undefined
          }
        />
        <SummaryTile
          label="Year-to-Date"
          value={sub.totalYtdCost}
          currency={sub.currency}
          subtext="Jan 1 → today"
        />
      </div>

      {sub.budget && <BudgetBar budget={sub.budget} />}

      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: "1px solid var(--orbit-border)" }}
        >
          <DollarSign className="h-4 w-4" style={{ color: "var(--orbit-text-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--orbit-text-primary)" }}>
            Top Services by Cost (MTD)
          </span>
          <span className="ml-auto text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            {sub.topServices.length} services
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--orbit-border)" }}>
              {["Service", "Share", "Cost"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs font-semibold"
                  style={{ color: "var(--orbit-text-muted)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sub.topServices.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-sm text-center"
                  style={{ color: "var(--orbit-text-muted)" }}
                >
                  No cost data available for this billing period.
                </td>
              </tr>
            ) : (
              sub.topServices.map((s) => (
                <ServiceRow key={s.serviceName} service={s} maxCost={maxCost} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {sub.totalMtdCost !== null && sub.totalYtdCost !== null && sub.totalYtdCost > 0 && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
          style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
        >
          <TrendingUp className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
          <span style={{ color: "var(--orbit-text-secondary)" }}>
            MTD {fmtCurrency(sub.totalMtdCost, sub.currency)} is{" "}
            {((sub.totalMtdCost / sub.totalYtdCost) * 100).toFixed(1)}% of YTD{" "}
            {fmtCurrency(sub.totalYtdCost, sub.currency)}
          </span>
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CostDashboard() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCostMetrics();

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Cost NOC
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Azure Cost Management · per-subscription MTD &amp; YTD · auto-refreshes every 5 min
            {lastUpdated && <span className="ml-2">· Last updated {lastUpdated}</span>}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{
            background: "var(--orbit-bg-card)",
            border: "1px solid var(--orbit-border)",
            color: "var(--orbit-text-secondary)",
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-16" style={{ color: "var(--orbit-text-muted)" }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Fetching cost data…</span>
        </div>
      ) : error ? (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ color: "#ef4444", border: "1px solid #ef444433", background: "var(--orbit-bg-card)" }}
        >
          {error.message}
        </div>
      ) : data ? (
        <>
          {!data.subscriptionConfigured && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#f59e0b",
              }}
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                No subscriptions configured — set{" "}
                <code className="font-mono text-xs">AZURE_SUBSCRIPTION_IDS</code> (comma-separated) and{" "}
                <code className="font-mono text-xs">AZURE_SUBSCRIPTION_LABELS</code> (e.g.{" "}
                <code className="font-mono text-xs">SharedPlatform,GrailBabe</code>).
              </span>
            </div>
          )}

          {/* Per-subscription sections */}
          {data.subscriptions.map((sub) => (
            <SubscriptionSection key={sub.subscriptionId} sub={sub} />
          ))}

          {/* M365 section */}
          <M365Section m365={data.m365} />

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Captured at {new Date(data.capturedAt).toLocaleString()} · data via Azure Cost Management Query API
          </p>
        </>
      ) : null}
    </div>
  );
}
