import { useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListAlertConfig,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

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

export function useInfraThresholdAlerts(): { overThresholdCount: number } {
  const { data: configs } = useListAlertConfig();

  const infraQueries = useQueries({
    queries: (configs ?? []).map((row) =>
      getGetInfrastructureQueryOptions(row.appId)
    ),
  });

  const prevStateRef = useRef<Map<string, boolean>>(new Map());
  const initializedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!configs || configs.length === 0) return;

    const newViolations: string[] = [];

    configs.forEach((row, i) => {
      const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
      if (!infraData) return;

      const cpu = getLatestValue(infraData, "CPU %");
      const mem = getLatestValue(infraData, "Memory %");

      const cpuKey = `${row.appId}:cpu`;
      const memKey = `${row.appId}:mem`;

      if (cpu !== null) {
        const isAbove = cpu >= row.cpuThresholdPct;
        const firstSeen = !initializedRef.current.has(cpuKey);

        if (firstSeen) {
          initializedRef.current.add(cpuKey);
          prevStateRef.current.set(cpuKey, isAbove);
        } else {
          const wasAbove = prevStateRef.current.get(cpuKey) ?? false;
          prevStateRef.current.set(cpuKey, isAbove);

          if (!wasAbove && isAbove) {
            newViolations.push(
              `${row.appName} — CPU ${cpu.toFixed(1)}% (threshold ${row.cpuThresholdPct}%)`
            );
          }
        }
      }

      if (mem !== null) {
        const isAbove = mem >= row.memoryThresholdPct;
        const firstSeen = !initializedRef.current.has(memKey);

        if (firstSeen) {
          initializedRef.current.add(memKey);
          prevStateRef.current.set(memKey, isAbove);
        } else {
          const wasAbove = prevStateRef.current.get(memKey) ?? false;
          prevStateRef.current.set(memKey, isAbove);

          if (!wasAbove && isAbove) {
            newViolations.push(
              `${row.appName} — Memory ${mem.toFixed(1)}% (threshold ${row.memoryThresholdPct}%)`
            );
          }
        }
      }
    });

    if (newViolations.length === 0) return;

    const title =
      newViolations.length === 1
        ? "Infra threshold crossed"
        : `${newViolations.length} infra thresholds crossed`;

    toast({ title, description: newViolations.join("\n"), variant: "destructive" });
  }, [configs, infraQueries]);

  const overThresholdCount = (configs ?? []).reduce((count, row, i) => {
    const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
    if (!infraData) return count;

    const cpu = getLatestValue(infraData, "CPU %");
    const mem = getLatestValue(infraData, "Memory %");

    const cpuOver = cpu !== null && cpu >= row.cpuThresholdPct;
    const memOver = mem !== null && mem >= row.memoryThresholdPct;

    return cpuOver || memOver ? count + 1 : count;
  }, 0);

  return { overThresholdCount };
}
