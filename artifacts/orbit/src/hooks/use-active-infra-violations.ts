import { useQueries } from "@tanstack/react-query";
import {
  useListAlertConfig,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import type { ActiveViolation } from "@/hooks/use-infra-threshold-alerts";
import { INFRASTRUCTURE_DEFAULT_REFETCH_INTERVAL } from "@/hooks/use-app-infrastructure";

export { INFRASTRUCTURE_DEFAULT_REFETCH_INTERVAL };

function getLatestValue(
  report: InfrastructureReport | undefined,
  seriesName: string
): number | null {
  if (!report) return null;
  const series = report.series.find((s: MetricSeries) => s.name === seriesName);
  if (!series || series.points.length === 0) return null;
  const sorted = [...series.points].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return sorted[0].value;
}

export function useActiveInfraViolations(
  refetchInterval: number = INFRASTRUCTURE_DEFAULT_REFETCH_INTERVAL
): ActiveViolation[] {
  const { data: configs } = useListAlertConfig();

  const infraQueries = useQueries({
    queries: (configs ?? []).map((row) => ({
      ...getGetInfrastructureQueryOptions(row.appId),
      refetchInterval: refetchInterval > 0 ? refetchInterval : false,
      refetchIntervalInBackground: false,
    })),
  });

  const violations: ActiveViolation[] = [];

  (configs ?? []).forEach((row, i) => {
    const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
    if (!infraData) return;

    const cpu = getLatestValue(infraData, "CPU %");
    const mem = getLatestValue(infraData, "Memory %");

    if (cpu !== null && cpu >= row.cpuThresholdPct) {
      violations.push({
        appId: row.appId,
        appName: row.appName,
        metric: "cpu",
        value: cpu,
        threshold: row.cpuThresholdPct,
      });
    }
    if (mem !== null && mem >= row.memoryThresholdPct) {
      violations.push({
        appId: row.appId,
        appName: row.appName,
        metric: "mem",
        value: mem,
        threshold: row.memoryThresholdPct,
      });
    }
  });

  return violations;
}
