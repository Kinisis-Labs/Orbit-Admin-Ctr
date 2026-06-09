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

export type DailySpendRange = 7 | 14 | 30 | 60 | 90;

export function computeAnomalies(
  data: DailyCostPoint[],
  range: DailySpendRange,
  sigmas: number,
): EnrichedPoint[] {
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
