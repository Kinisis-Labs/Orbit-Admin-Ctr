import { useState, useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";
import { DailySpendTooltip } from "@/components/daily-spend-tooltip";
import { computeAnomalies } from "@/components/daily-spend-utils";
import type { DailyCostPoint, EnrichedPoint, DailySpendRange as Range } from "@/components/daily-spend-utils";

export type { DailyCostPoint, EnrichedPoint, DailySpendRange } from "@/components/daily-spend-utils";

const BAR_COLOR_DEFAULT = "hsl(var(--primary))";
const BAR_COLOR_UP_MILD = "hsl(38 92% 50%)";
const BAR_COLOR_UP_HIGH = "hsl(var(--destructive))";
const BAR_COLOR_DOWN = "hsl(160 84% 39%)";
const BAR_COLOR_ANOMALY = "hsl(32 98% 46%)";
const BAR_COLOR_PEAK = "hsl(45 100% 51%)";
const ANOMALY_OUTLINE_COLOR = "hsl(32 98% 46%)";
const OVER_BUDGET_STROKE_COLOR = "hsl(0 84% 40%)";

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

const BUDGET_LINE_COLOR = "hsl(var(--destructive))";

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
  budgetLine,
  range: rangeProp,
  onRangeChange,
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
  budgetLine?: number;
  range?: Range;
  onRangeChange?: (r: Range) => void;
}) {
  const maxDays = daily.length;
  const defaultRange: Range = maxDays >= 30 ? 30 : maxDays >= 14 ? 14 : 7;
  const isControlled = rangeProp !== undefined;
  const [internalRange, setInternalRange] = useState<Range>(rangeProp ?? defaultRange);
  const range = isControlled ? rangeProp! : internalRange;

  function setRange(r: Range) {
    if (!isControlled) setInternalRange(r);
    onRangeChange?.(r);
  }

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

  const hasAnyOverBudget = useMemo(
    () => budgetLine != null && budgetLine > 0 && visibleDataWithPeak.some((d) => d.value > budgetLine),
    [visibleDataWithPeak, budgetLine],
  );

  const hasAnyPeakAnomaly = useMemo(
    () =>
      highlightPeak &&
      showAnomalies &&
      visibleDataWithPeak.some((d) => d.isPeak && (d as EnrichedPoint).anomaly?.isAnomaly),
    [visibleDataWithPeak, highlightPeak, showAnomalies],
  );

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
            {budgetLine != null && budgetLine > 0 && (
              <Bar dataKey="value" radius={0} fill="transparent" legendType="none">
                {visibleDataWithPeak.map((entry, idx) => {
                  const isOverBudget = entry.value > budgetLine;
                  return (
                    <Cell
                      key={idx}
                      fill="transparent"
                      stroke={isOverBudget ? OVER_BUDGET_STROKE_COLOR : "none"}
                      strokeWidth={isOverBudget ? 3 : 0}
                    />
                  );
                })}
              </Bar>
            )}
            {budgetLine != null && budgetLine > 0 && (
              <ReferenceLine
                y={budgetLine}
                stroke={BUDGET_LINE_COLOR}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: "Daily budget",
                  position: "insideTopRight",
                  fill: BUDGET_LINE_COLOR,
                  fontSize: 10,
                  fontWeight: 500,
                  dy: -4,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(showLegend || hasAnyAnomaly || hasAnyOverBudget) && (
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
              {hasAnyPeakAnomaly ? (
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 shrink-0"
                    style={{
                      background: BAR_COLOR_PEAK,
                      outline: `2px solid ${ANOMALY_OUTLINE_COLOR}`,
                      outlineOffset: 1,
                    }}
                  />
                  <span>Peak &amp; anomaly</span>
                </div>
              ) : (
                <>
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
            </>
          )}
          {hasAnyAnomaly && !colorByTrend && (
            <div className="flex items-center gap-1.5">
              {hasAnyPeakAnomaly ? (
                <span
                  className="inline-block w-2.5 h-2.5 shrink-0"
                  style={{
                    background: BAR_COLOR_PEAK,
                    outline: `2px solid ${ANOMALY_OUTLINE_COLOR}`,
                    outlineOffset: 1,
                  }}
                />
              ) : (
                <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ background: BAR_COLOR_ANOMALY }} />
              )}
              <span>
                {hasAnyPeakAnomaly
                  ? "Peak & anomaly"
                  : `Spend anomaly (>${anomalySigmas}σ above window average)`}
              </span>
            </div>
          )}
          {hasAnyOverBudget && (
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 shrink-0"
                style={{ border: `3px solid ${OVER_BUDGET_STROKE_COLOR}`, background: "transparent" }}
              />
              <span>Over daily budget</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
