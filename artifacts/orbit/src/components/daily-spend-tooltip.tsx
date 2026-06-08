import { format } from "date-fns";
import type { TooltipProps } from "recharts";

type AnomalyInfo = {
  isAnomaly: boolean;
  vsAvgMultiple: number;
  windowLabel: string;
};

export function DailySpendTooltip({
  active,
  payload,
  label,
  formatCurrency,
}: TooltipProps<number, string> & { formatCurrency: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as {
    value: number;
    vsLastWeek?: number | null;
    anomaly?: AnomalyInfo;
    isPeak?: boolean;
  };
  const vsLastWeek = point.vsLastWeek;
  const isUp = vsLastWeek != null && vsLastWeek > 0;
  const isDown = vsLastWeek != null && vsLastWeek < 0;
  const anomaly = point.anomaly;
  const showAnomaly = anomaly?.isAnomaly;
  const isPeakAndAnomaly = point.isPeak && showAnomaly;

  return (
    <div
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: showAnomaly ? "hsl(32 98% 46%)" : "hsl(var(--border))",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 2,
        fontSize: 12,
        padding: "6px 10px",
      }}
    >
      <div className="flex items-center gap-1.5 font-medium text-foreground mb-1">
        {label ? format(new Date(label as string), "MMM d, yyyy") : ""}
        {isPeakAndAnomaly ? (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 3,
              background: "hsl(32 98% 46% / 0.18)",
              color: "hsl(32 98% 34%)",
              fontWeight: 600,
              letterSpacing: "0.02em",
              border: "1px solid hsl(32 98% 46% / 0.35)",
            }}
          >
            Peak &amp; anomaly
          </span>
        ) : (
          <>
            {point.isPeak && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "hsl(38 92% 50% / 0.15)",
                  color: "hsl(38 92% 40%)",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                Peak day
              </span>
            )}
            {showAnomaly && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "hsl(32 98% 46% / 0.15)",
                  color: "hsl(32 98% 36%)",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                Anomaly
              </span>
            )}
          </>
        )}
      </div>
      <div className="text-foreground tabular-nums">
        Cost: {formatCurrency(point.value)}
      </div>
      {showAnomaly && anomaly && (
        <div className="tabular-nums mt-0.5" style={{ color: "hsl(32 98% 46%)" }}>
          {isPeakAndAnomaly
            ? `Peak day — ${anomaly.vsAvgMultiple.toFixed(1)}× ${anomaly.windowLabel} avg`
            : `${anomaly.vsAvgMultiple.toFixed(1)}× ${anomaly.windowLabel} avg`}
        </div>
      )}
      {vsLastWeek != null && (
        <div
          className={`tabular-nums mt-0.5 ${isUp ? "text-destructive" : isDown ? "text-emerald-500" : "text-muted-foreground"}`}
        >
          {isUp ? "↑" : isDown ? "↓" : "—"} {Math.abs(vsLastWeek).toFixed(1)}% vs last week
        </div>
      )}
    </div>
  );
}
