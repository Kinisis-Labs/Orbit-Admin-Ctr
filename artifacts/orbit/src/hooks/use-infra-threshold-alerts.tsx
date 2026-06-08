import { useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListAlertConfig,
  getGetInfrastructureQueryOptions,
} from "@workspace/api-client-react";
import type { InfrastructureReport, MetricSeries } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  appendViolation,
  markViolationsDismissed,
  useViolationLog,
} from "@/hooks/use-violation-log";

const STORAGE_PREFIX = "infra-alert-snooze";

const SNOOZE_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "8 hours", hours: 8 },
  { label: "24 hours", hours: 24 },
] as const;

function getSnoozeKey(appId: string, metric: "cpu" | "mem"): string {
  return `${STORAGE_PREFIX}:${appId}:${metric}`;
}

function isAlertSnoozed(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    return parseInt(raw, 10) > Date.now();
  } catch {
    return false;
  }
}

function snoozeAlert(key: string, hours: number): void {
  try {
    localStorage.setItem(key, String(Date.now() + hours * 3_600_000));
  } catch {
    // localStorage may be unavailable; fail silently
  }
}

interface SnoozeTarget {
  snoozeKey: string;
  appId: string;
  metric: "cpu" | "mem";
}

function SnoozeMenu({
  targets,
  onSnooze,
}: {
  targets: SnoozeTarget[];
  onSnooze: (hours: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-muted/40 bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive"
          type="button"
        >
          Snooze <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          align="end"
          side="top"
          className="z-[200] min-w-[130px]"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {SNOOZE_OPTIONS.map(({ label, hours }) => (
            <DropdownMenuItem
              key={hours}
              onSelect={() => {
                targets.forEach(({ snoozeKey, appId, metric }) => {
                  snoozeAlert(snoozeKey, hours);
                  markViolationsDismissed(appId, metric);
                });
                onSnooze(hours);
              }}
            >
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
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

export interface ActiveViolation {
  appId: string;
  appName: string;
  metric: "cpu" | "mem";
  value: number;
  threshold: number;
}

export type InfraViolation = ActiveViolation;

export function useInfraThresholdAlerts(): {
  overThresholdCount: number;
  unseenViolationCount: number;
  activeViolations: ActiveViolation[];
  violations: InfraViolation[];
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
    const newViolationTargets: SnoozeTarget[] = [];

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
            const snoozeKey = getSnoozeKey(row.appId, "cpu");
            if (!isAlertSnoozed(snoozeKey)) {
              newViolations.push(
                `${row.appName} — CPU ${cpu.toFixed(1)}% (threshold ${row.cpuThresholdPct}%)`
              );
              newViolationTargets.push({ snoozeKey, appId: row.appId, metric: "cpu" });
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
            const snoozeKey = getSnoozeKey(row.appId, "mem");
            if (!isAlertSnoozed(snoozeKey)) {
              newViolations.push(
                `${row.appName} — Memory ${mem.toFixed(1)}% (threshold ${row.memoryThresholdPct}%)`
              );
              newViolationTargets.push({ snoozeKey, appId: row.appId, metric: "mem" });
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

    const snapshot = [...newViolationTargets];

    let dismissToast: (() => void) | undefined;

    const action = (
      <SnoozeMenu
        targets={snapshot}
        onSnooze={() => {
          dismissToast?.();
        }}
      />
    );

    const { dismiss } = toast({
      title,
      description: newViolations.join("\n"),
      variant: "destructive",
      duration: 30_000,
      action,
    });

    dismissToast = dismiss;
  }, [configs, infraQueries]);

  const activeViolations: ActiveViolation[] = [];
  let overThresholdCount = 0;

  (configs ?? []).forEach((row, i) => {
    const infraData = infraQueries[i]?.data as InfrastructureReport | undefined;
    if (!infraData) return;

    const cpu = getLatestValue(infraData, "CPU %");
    const mem = getLatestValue(infraData, "Memory %");

    const cpuOver = cpu !== null && cpu >= row.cpuThresholdPct;
    const memOver = mem !== null && mem >= row.memoryThresholdPct;

    if (cpuOver || memOver) overThresholdCount += 1;

    if (cpuOver && cpu !== null) {
      activeViolations.push({
        appId: row.appId,
        appName: row.appName,
        metric: "cpu",
        value: cpu,
        threshold: row.cpuThresholdPct,
      });
    }
    if (memOver && mem !== null) {
      activeViolations.push({
        appId: row.appId,
        appName: row.appName,
        metric: "mem",
        value: mem,
        threshold: row.memoryThresholdPct,
      });
    }
  });

  return { overThresholdCount, unseenViolationCount: unseenCount, activeViolations, violations: activeViolations };
}
