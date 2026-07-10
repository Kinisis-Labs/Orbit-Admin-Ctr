import { RefreshCw, Loader2, Info, DollarSign, TrendingUp } from "lucide-react";
import { useCostMetrics, type CostByService, type BudgetInfo } from "../../services/noc";

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

  const maxCost = data?.topServices[0]?.cost ?? 1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--orbit-text-primary)" }}>
            Cost NOC
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--orbit-text-muted)" }}>
            Azure Cost Management · MTD &amp; YTD spend · top 10 services · auto-refreshes every 5 min
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
                Azure subscription not configured — set{" "}
                <code className="font-mono text-xs">AZURE_SUBSCRIPTION_ID</code> to enable cost data.
                Optionally set <code className="font-mono text-xs">AZURE_BUDGET_NAME</code> for budget tracking.
              </span>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-4">
            <SummaryTile
              label="Month-to-Date Spend"
              value={data.totalMtdCost}
              currency={data.currency}
              subtext="current billing month"
              highlight={
                data.budget && data.totalMtdCost !== null && data.totalMtdCost / data.budget.limit > 0.9
                  ? "red"
                  : data.budget && data.totalMtdCost !== null && data.totalMtdCost / data.budget.limit > 0.75
                    ? "yellow"
                    : undefined
              }
            />
            <SummaryTile
              label="Year-to-Date Spend"
              value={data.totalYtdCost}
              currency={data.currency}
              subtext="Jan 1 → today"
            />
          </div>

          {/* Budget bar */}
          {data.budget && <BudgetBar budget={data.budget} />}

          {/* Top services table */}
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
                {data.topServices.length} services
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
                {data.topServices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-sm text-center"
                      style={{ color: "var(--orbit-text-muted)" }}
                    >
                      {data.subscriptionConfigured
                        ? "No cost data available for this billing period."
                        : "Configure AZURE_SUBSCRIPTION_ID to view cost breakdown."}
                    </td>
                  </tr>
                ) : (
                  data.topServices.map((s) => (
                    <ServiceRow key={s.serviceName} service={s} maxCost={maxCost} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Trend hint */}
          {data.totalMtdCost !== null && data.totalYtdCost !== null && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
              style={{ background: "var(--orbit-bg-card)", border: "1px solid var(--orbit-border)" }}
            >
              <TrendingUp className="h-4 w-4 shrink-0" style={{ color: "var(--orbit-text-muted)" }} />
              <span style={{ color: "var(--orbit-text-secondary)" }}>
                MTD spend is{" "}
                <strong>
                  {fmtCurrency(data.totalMtdCost, data.currency)}
                </strong>{" "}
                out of{" "}
                <strong>
                  {fmtCurrency(data.totalYtdCost, data.currency)}
                </strong>{" "}
                YTD (
                {data.totalYtdCost > 0
                  ? `${((data.totalMtdCost / data.totalYtdCost) * 100).toFixed(1)}% of YTD`
                  : "—"}
                )
              </span>
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--orbit-text-muted)" }}>
            Captured at {new Date(data.capturedAt).toLocaleString()} · data via Azure Cost Management Query API
          </p>
        </>
      ) : null}
    </div>
  );
}
