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
  };
  const vsLastWeek = point.vsLastWeek;
  const isUp = vsLastWeek != null && vsLastWeek > 0;
  const isDown = vsLastWeek != null && vsLastWeek < 0;
  const anomaly = point.anomaly;
  const showAnomaly = anomaly?.isAnomaly;

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
      <div className="font-medium text-foreground mb-1">
        {label ? format(new Date(label as string), "MMM d, yyyy") : ""}
      </div>
      <div className="text-foreground tabular-nums">
        Cost: {formatCurrency(point.value)}
      </div>
      {vsLastWeek != null && (
        <div
          className={`tabular-nums mt-0.5 ${isUp ? "text-destructive" : isDown ? "text-emerald-500" : "text-muted-foreground"}`}
        >
          {isUp ? "↑" : isDown ? "↓" : "—"} {Math.abs(vsLastWeek).toFixed(1)}% vs last week
        </div>
      )}
      {showAnomaly && anomaly && (
        <div className="mt-1.5 pt-1.5 border-t border-border/60 flex items-center gap-1 text-[11px] font-medium" style={{ color: "hsl(32 98% 46%)" }}>
          <span>⚠</span>
          <span>
            {anomaly.vsAvgMultiple.toFixed(1)}× {anomaly.windowLabel} average
          </span>
        </div>
      )}
    </div>
  );
}
