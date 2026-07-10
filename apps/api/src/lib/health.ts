import { db } from "./db.js";
import { applicationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HistoryPoint {
  status: HealthStatus;
  latencyMs: number;
  checkedAt: string;
}

export interface ServiceCheck {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  httpStatus?: number;
  timedOut?: boolean;
  history: HistoryPoint[];
  checkedAt: string;
}

export interface PlatformHealthReport {
  overall: HealthStatus;
  orbit: ServiceCheck;
  database: ServiceCheck;
  applications: ServiceCheck[];
  checkedAt: string;
}

/** In-memory history ring — last 10 checks per app name. */
const historyRing = new Map<string, HistoryPoint[]>();
const HISTORY_MAX = 10;

function pushHistory(name: string, point: HistoryPoint): HistoryPoint[] {
  const ring = historyRing.get(name) ?? [];
  ring.push(point);
  if (ring.length > HISTORY_MAX) ring.shift();
  historyRing.set(name, ring);
  return [...ring];
}

/** Check database connectivity by running a trivial query. */
export async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    const history = pushHistory("database", { status: "healthy", latencyMs, checkedAt });
    return { name: "database", status: "healthy", latencyMs, history, checkedAt };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const history = pushHistory("database", { status: "unhealthy", latencyMs, checkedAt });
    return {
      name: "database",
      status: "unhealthy",
      latencyMs,
      message: err instanceof Error ? err.message : String(err),
      history,
      checkedAt,
    };
  }
}

/** Probe a registered application's healthCheckUrl (GET, 5 s timeout). */
export async function checkAppEndpoint(
  name: string,
  url: string,
): Promise<ServiceCheck> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const status: HealthStatus = res.ok ? "healthy" : "degraded";
    const history = pushHistory(name, { status, latencyMs, checkedAt });
    return {
      name,
      status,
      latencyMs,
      httpStatus: res.status,
      timedOut: false,
      message: res.ok ? undefined : `HTTP ${res.status}`,
      history,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.includes("abort") || msg.includes("The operation was aborted");
    const history = pushHistory(name, { status: "unhealthy", latencyMs, checkedAt });
    return {
      name,
      status: "unhealthy",
      latencyMs,
      timedOut,
      message: timedOut ? "Timeout after 5s" : msg,
      history,
      checkedAt,
    };
  }
}

/** Aggregate full platform health: Orbit process + DB + all registered app health endpoints. */
export async function getPlatformHealth(): Promise<PlatformHealthReport> {
  const checkedAt = new Date().toISOString();

  const orbit: ServiceCheck = {
    name: "orbit-api",
    status: "healthy",
    latencyMs: 0,
    message: `Node ${process.version}, uptime ${Math.floor(process.uptime())}s`,
    history: pushHistory("orbit-api", { status: "healthy", latencyMs: 0, checkedAt }),
    checkedAt,
  };

  const dbCheck = await checkDatabase();

  let appChecks: ServiceCheck[] = [];
  try {
    const apps = await db
      .select({ displayName: applicationsTable.displayName, healthCheckUrl: applicationsTable.healthCheckUrl })
      .from(applicationsTable)
      .where(eq(applicationsTable.enabled, true));

    const withUrls = apps.filter((a) => a.healthCheckUrl);
    appChecks = await Promise.all(
      withUrls.map((a) => checkAppEndpoint(a.displayName, a.healthCheckUrl!)),
    );
  } catch {
    // Non-fatal — report no app checks
  }

  const allChecks = [dbCheck, ...appChecks];
  const overall: HealthStatus =
    allChecks.some((c) => c.status === "unhealthy")
      ? "unhealthy"
      : allChecks.some((c) => c.status === "degraded")
        ? "degraded"
        : "healthy";

  return { overall, orbit, database: dbCheck, applications: appChecks, checkedAt };
}
