import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { DailySpendTooltip } from "@/components/daily-spend-tooltip";

type DailyCostPoint = {
  timestamp: string | Date;
  value: number;
  vsLastWeek?: number | null;
};

type Range = 7 | 14 | 30;

const BAR_COLOR_DEFAULT = "hsl(var(--primary))";
const BAR_COLOR_UP_MILD = "hsl(38 92% 50%)";
const BAR_COLOR_UP_HIGH = "hsl(var(--destructive))";
const BAR_COLOR_DOWN = "hsl(160 84% 39%)";

function getBarFill(vsLastWeek: number | null | undefined, threshold: number): string {
  if (vsLastWeek == null) return BAR_COLOR_DEFAULT;
  if (vsLastWeek > threshold) return BAR_COLOR_UP_HIGH;
  if (vsLastWeek > 0) return BAR_COLOR_UP_MILD;
  return BAR_COLOR_DOWN;
}

const RANGE_OPTIONS: { label: string; days: Range }[] = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
];

export function DailySpendChart({
  daily,
  formatCurrency,
  colorByTrend = false,
  showLegend = false,
  threshold = 15,
}: {
  daily: DailyCostPoint[];
  formatCurrency: (v: number) => string;
  colorByTrend?: boolean;
  showLegend?: boolean;
  threshold?: number;
}) {
  const maxDays = daily.length;
  const defaultRange: Range = maxDays >= 30 ? 30 : maxDays >= 14 ? 14 : 7;
  const [range, setRange] = useState<Range>(defaultRange);

  const visibleData = useMemo(() => {
    return daily.slice(-range);
  }, [daily, range]);

  const availableRanges = RANGE_OPTIONS.filter((o) => o.days <= Math.max(maxDays, 7));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-1 px-1 pb-2 shrink-0">
        {availableRanges.map((opt) => (
          <button
            key={opt.days}
            onClick={() => setRange(opt.days)}
            className={[
              "h-6 px-2 text-[11px] font-medium rounded-sm border transition-colors",
              range === opt.days
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80",
            ].join(" ")}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={visibleData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(v) => format(new Date(v), range <= 7 ? "EEE, MMM d" : "MMM d")}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `$${v}`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<DailySpendTooltip formatCurrency={formatCurrency} />}
              cursor={{ fill: "hsl(var(--muted))" }}
            />
            {colorByTrend ? (
              <Bar dataKey="value" radius={0}>
                {visibleData.map((entry, idx) => (
                  <Cell key={idx} fill={getBarFill(entry.vsLastWeek, threshold)} />
                ))}
              </Bar>
            ) : (
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={0} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {showLegend && colorByTrend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-2 pb-1 text-[11px] text-muted-foreground shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_DOWN }} />
            <span>Below last week</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_UP_MILD }} />
            <span>Up 0–{threshold}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_UP_HIGH }} />
            <span>Up &gt;{threshold}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_DEFAULT }} />
            <span>No prior data</span>
          </div>
        </div>
      )}
    </div>
  );
}
