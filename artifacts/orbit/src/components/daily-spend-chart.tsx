import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { DailySpendTooltip } from "@/components/daily-spend-tooltip";

export type DailyCostPoint = {
  timestamp: string | Date;
  value: number;
  vsLastWeek?: number | null;
  isPeak?: boolean;
};

export type EnrichedPoint = DailyCostPoint & {
  anomaly?: {
    isAnomaly: boolean;
    vsAvgMultiple: number;
    windowLabel: string;
  };
};

type Range = 7 | 14 | 30;

const BAR_COLOR_DEFAULT = "hsl(var(--primary))";
const BAR_COLOR_UP_MILD = "hsl(38 92% 50%)";
const BAR_COLOR_UP_HIGH = "hsl(var(--destructive))";
const BAR_COLOR_DOWN = "hsl(160 84% 39%)";
const BAR_COLOR_ANOMALY = "hsl(32 98% 46%)";
const BAR_COLOR_PEAK = "hsl(45 100% 51%)";
const ANOMALY_OUTLINE_COLOR = "hsl(32 98% 46%)";

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

export function computeAnomalies(data: DailyCostPoint[], range: Range, sigmas: number): EnrichedPoint[] {
  const values = data.map((d) => d.value);
  if (values.length < 3) return data.map((d) => ({ ...d }));

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const sigma = Math.sqrt(variance);
  const anomalyThreshold = mean + sigmas * sigma;
  const windowLabel = `${range}d`;

  return data.map((d) => ({
    ...d,
    anomaly: {
      isAnomaly: d.value > anomalyThreshold && mean > 0,
      vsAvgMultiple: mean > 0 ? d.value / mean : 1,
      windowLabel,
    },
  }));
}

export function DailySpendChart({
  daily,
  formatCurrency,
  colorByTrend = false,
  showAnomalies = true,
  showLegend = false,
  highlightPeak = false,
  threshold = 15,
  anomalySigmas = 2,
  onAnomalyClick,
}: {
  daily: DailyCostPoint[];
  formatCurrency: (v: number) => string;
  colorByTrend?: boolean;
  showAnomalies?: boolean;
  showLegend?: boolean;
  highlightPeak?: boolean;
  threshold?: number;
  anomalySigmas?: number;
  onAnomalyClick?: (date: Date) => void;
}) {
  const maxDays = daily.length;
  const defaultRange: Range = maxDays >= 30 ? 30 : maxDays >= 14 ? 14 : 7;
  const [range, setRange] = useState<Range>(defaultRange);

  const visibleData = useMemo(() => {
    const sliced = daily.slice(-range);
    return showAnomalies ? computeAnomalies(sliced, range, anomalySigmas) : sliced.map((d) => ({ ...d }));
  }, [daily, range, showAnomalies, anomalySigmas]);

  const hasAnyAnomaly = useMemo(
    () => showAnomalies && visibleData.some((d) => (d as EnrichedPoint).anomaly?.isAnomaly),
    [visibleData, showAnomalies],
  );

  const visibleDataWithPeak = useMemo(() => {
    if (!highlightPeak || !visibleData.length) return visibleData;
    const max = Math.max(...visibleData.map((d) => d.value));
    const hasVariance = visibleData.some((d) => d.value !== max);
    return visibleData.map((d) => ({ ...d, isPeak: hasVariance && d.value === max }));
  }, [visibleData, highlightPeak]);

  const availableRanges = RANGE_OPTIONS.filter((o) => o.days <= Math.max(maxDays, 7));

  function getCellFill(entry: EnrichedPoint): string {
    if (colorByTrend) {
      return getBarFill(entry.vsLastWeek, threshold);
    }
    if (showAnomalies && entry.anomaly?.isAnomaly) {
      return BAR_COLOR_ANOMALY;
    }
    return BAR_COLOR_DEFAULT;
  }

  const needsCells = colorByTrend || showAnomalies || highlightPeak;

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
          <BarChart data={visibleDataWithPeak} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
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
            {needsCells ? (
              <Bar
                dataKey="value"
                radius={0}
                onClick={
                  onAnomalyClick
                    ? (entry: EnrichedPoint) => {
                        if (colorByTrend && entry.anomaly?.isAnomaly) {
                          onAnomalyClick(new Date(entry.timestamp));
                        }
                      }
                    : undefined
                }
              >
                {visibleDataWithPeak.map((entry, idx) => {
                  const isClickableAnomaly =
                    colorByTrend && (entry as EnrichedPoint).anomaly?.isAnomaly && !!onAnomalyClick;
                  return (
                    <Cell
                      key={idx}
                      fill={entry.isPeak ? BAR_COLOR_PEAK : getCellFill(entry as EnrichedPoint)}
                      style={isClickableAnomaly ? { cursor: "pointer" } : undefined}
                    />
                  );
                })}
              </Bar>
            ) : (
              <Bar dataKey="value" fill={BAR_COLOR_DEFAULT} radius={0} />
            )}
            {colorByTrend && showAnomalies && (
              <Bar dataKey="value" radius={0} fill="transparent" legendType="none">
                {visibleData.map((entry, idx) => {
                  const isAnomaly = (entry as EnrichedPoint).anomaly?.isAnomaly;
                  return (
                    <Cell
                      key={idx}
                      fill="transparent"
                      stroke={isAnomaly ? ANOMALY_OUTLINE_COLOR : "none"}
                      strokeWidth={isAnomaly ? 2 : 0}
                    />
                  );
                })}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(showLegend || hasAnyAnomaly) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-2 pb-1 text-[11px] text-muted-foreground shrink-0">
          {showLegend && colorByTrend && (
            <>
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
              {highlightPeak && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_PEAK }} />
                  <span>Peak day</span>
                </div>
              )}
              {hasAnyAnomaly && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 shrink-0"
                    style={{ border: `2px solid ${ANOMALY_OUTLINE_COLOR}`, background: "transparent" }}
                  />
                  <span>Spend anomaly (&gt;{anomalySigmas}σ above window average)</span>
                </div>
              )}
            </>
          )}
          {hasAnyAnomaly && !colorByTrend && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_ANOMALY }} />
              <span>Spend anomaly (&gt;{anomalySigmas}σ above window average)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
