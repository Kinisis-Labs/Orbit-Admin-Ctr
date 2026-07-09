import { db } from "./db.js";
import { applicationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface ServiceCheck {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

export interface PlatformHealthReport {
  overall: HealthStatus;
  orbit: ServiceCheck;
  database: ServiceCheck;
  applications: ServiceCheck[];
  checkedAt: string;
}

/** Check database connectivity by running a trivial query. */
export async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      name: "database",
      status: "healthy",
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: "database",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Probe a registered application's healthCheckUrl (GET, 5 s timeout). */
export async function checkAppEndpoint(
  name: string,
  url: string,
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const status: HealthStatus = res.ok ? "healthy" : "degraded";
    return { name, status, latencyMs, message: res.ok ? undefined : `HTTP ${res.status}`, checkedAt: new Date().toISOString() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - start,
      message: msg.includes("abort") ? "Timeout after 5s" : msg,
      checkedAt: new Date().toISOString(),
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
    checkedAt,
  };

  const dbCheck = await checkDatabase();

  // Fetch all enabled apps that have a health check URL
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
