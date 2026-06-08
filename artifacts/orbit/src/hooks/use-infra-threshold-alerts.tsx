import { useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListAlertConfig,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  appendViolation,
  markViolationsDismissed,
  useViolationLog,
} from "@/hooks/use-violation-log";

const STORAGE_PREFIX = "infra-alert-ack";

function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function getDismissKey(appId: string, metric: "cpu" | "mem"): string {
  return `${STORAGE_PREFIX}:${appId}:${metric}:${hourBucket()}`;
}

function isAlertDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function dismissAlert(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // sessionStorage may be unavailable in some contexts; fail silently
  }
}

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

export function useInfraThresholdAlerts(): {
  overThresholdCount: number;
  unseenViolationCount: number;
} {
  const { data: configs } = useListAlertConfig();
  const { unseenCount } = useViolationLog();

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
    const newViolationKeys: Array<{ dismissKey: string; appId: string; metric: "cpu" | "mem" }> = [];

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
            appendViolation({
              appId: row.appId,
              appName: row.appName,
              metric: "cpu",
              value: cpu,
              threshold: row.cpuThresholdPct,
              timestamp: new Date().toISOString(),
              dismissed: false,
            });
            const dismissKey = getDismissKey(row.appId, "cpu");
            if (!isAlertDismissed(dismissKey)) {
              newViolations.push(
                `${row.appName} — CPU ${cpu.toFixed(1)}% (threshold ${row.cpuThresholdPct}%)`
              );
              newViolationKeys.push({ dismissKey, appId: row.appId, metric: "cpu" });
            }
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
            appendViolation({
              appId: row.appId,
              appName: row.appName,
              metric: "mem",
              value: mem,
              threshold: row.memoryThresholdPct,
              timestamp: new Date().toISOString(),
              dismissed: false,
            });
            const dismissKey = getDismissKey(row.appId, "mem");
            if (!isAlertDismissed(dismissKey)) {
              newViolations.push(
                `${row.appName} — Memory ${mem.toFixed(1)}% (threshold ${row.memoryThresholdPct}%)`
              );
              newViolationKeys.push({ dismissKey, appId: row.appId, metric: "mem" });
            }
          }
        }
      }
    });

    if (newViolations.length === 0) return;

    const title =
      newViolations.length === 1
        ? "Infra threshold crossed"
        : `${newViolations.length} infra thresholds crossed`;

    const snapshot = [...newViolationKeys];

    toast({
      title,
      description: newViolations.join("\n"),
      variant: "destructive",
      action: (
        <ToastAction
          altText="Dismiss"
          onClick={() => {
            snapshot.forEach(({ dismissKey, appId, metric }) => {
              dismissAlert(dismissKey);
              markViolationsDismissed(appId, metric);
            });
          }}
        >
          Dismiss
        </ToastAction>
      ),
    });
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

  return { overThresholdCount, unseenViolationCount: unseenCount };
}
