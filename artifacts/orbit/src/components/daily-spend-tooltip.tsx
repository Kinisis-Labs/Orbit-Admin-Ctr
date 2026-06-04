import { format } from "date-fns";
import type { TooltipProps } from "recharts";

export function DailySpendTooltip({
  active,
  payload,
  label,
  formatCurrency,
}: TooltipProps<number, string> & { formatCurrency: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as { value: number; vsLastWeek?: number | null };
  const vsLastWeek = point.vsLastWeek;
  const isUp = vsLastWeek != null && vsLastWeek > 0;
  const isDown = vsLastWeek != null && vsLastWeek < 0;
  return (
    <div
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
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
    </div>
  );
}
