import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { db } from "../../../lib/db.js";
import { applicationsTable } from "@workspace/db";

const router: IRouter = Router();

const KNOWN_APIS = [
  "Azure OpenAI",
  "OpenAI",
  "Stripe",
  "Rebrickable",
  "Magic The Gathering API",
  "TCG API All Card Games",
  "Pokemon TCG API",
  "Just TCG API",
  "Brickset",
  "API TCG",
  "Ximilar",
  "The Card API",
  "RoboFlow",
];

interface DependencyEntry {
  name: string;
  callsPerHour: number | null;
  calls24h: number | null;
  avgDurationMs: number | null;
  failedCalls: number | null;
  errorRate: number | null;
  lastSeen: string | null;
  configured: boolean;
}

interface DependencySnapshot {
  entries: DependencyEntry[];
  appSlug: string;
  appName: string;
  capturedAt: string;
  appInsightsConfigured: boolean;
}

async function queryDependencies(connectionString: string): Promise<DependencyEntry[]> {
  const match = connectionString.match(/ApplicationId=([^;]+)/i);
  const appId = match?.[1];
  const keyMatch = connectionString.match(/InstrumentationKey=([^;]+)/i);
  const apiKey = keyMatch?.[1];
  if (!appId || !apiKey) return [];

  const timespan = "PT24H";
  const url = `https://api.applicationinsights.io/v1/apps/${appId}/query`;

  const kql = `
dependencies
| where timestamp > ago(24h)
| summarize
    calls24h = count(),
    callsPerHour = round(count() / 24.0, 1),
    avgDurationMs = round(avg(duration), 1),
    failedCalls = countif(success == false),
    lastSeen = max(timestamp)
  by name
| order by calls24h desc
| take 50
`.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: kql, timespan }),
    });

    if (!res.ok) return [];

    type QueryResponse = {
      tables?: Array<{
        columns: Array<{ name: string }>;
        rows: Array<Array<string | number | boolean | null>>;
      }>;
    };

    const data = (await res.json()) as QueryResponse;
    const table = data.tables?.[0];
    if (!table) return [];

    const cols = table.columns.map((c) => c.name);
    const idx = (name: string) => cols.indexOf(name);

    return table.rows.map((row) => {
      const calls24h = row[idx("calls24h")] as number | null;
      const failedCalls = row[idx("failedCalls")] as number | null;
      const errorRate =
        calls24h && calls24h > 0 && failedCalls !== null
          ? Math.round((failedCalls / calls24h) * 1000) / 10
          : null;
      const lastSeenRaw = row[idx("lastSeen")];
      return {
        name: String(row[idx("name")] ?? "Unknown"),
        calls24h,
        callsPerHour: row[idx("callsPerHour")] as number | null,
        avgDurationMs: row[idx("avgDurationMs")] as number | null,
        failedCalls,
        errorRate,
        lastSeen: lastSeenRaw ? String(lastSeenRaw) : null,
        configured: true,
      };
    });
  } catch {
    return [];
  }
}

function mergeWithKnownApis(live: DependencyEntry[]): DependencyEntry[] {
  const liveMap = new Map(live.map((e) => [e.name.toLowerCase(), e]));
  const result: DependencyEntry[] = [...live];

  for (const known of KNOWN_APIS) {
    if (!liveMap.has(known.toLowerCase())) {
      result.push({
        name: known,
        callsPerHour: null,
        calls24h: null,
        avgDurationMs: null,
        failedCalls: null,
        errorRate: null,
        lastSeen: null,
        configured: false,
      });
    }
  }

  return result;
}

const CACHE_TTL_MS = 2 * 60 * 1000;
let cached: DependencySnapshot | null = null;
let cacheExpiresAt = 0;

router.get("/api-dependencies", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === "1";
    if (!forceRefresh && cached && now < cacheExpiresAt) {
      res.json(cached);
      return;
    }

    const [grailbabe] = await db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.slug, "grailbabe"))
      .limit(1);

    const globalConnStr =
      process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ??
      process.env.APPINSIGHTS_CONNECTION_STRING;
    const connStr = grailbabe?.appInsightsConnectionString ?? globalConnStr;

    const appInsightsConfigured = !!connStr;
    let entries: DependencyEntry[] = [];

    if (connStr) {
      const live = await queryDependencies(connStr);
      entries = mergeWithKnownApis(live);
    } else {
      entries = mergeWithKnownApis([]);
    }

    const payload: DependencySnapshot = {
      entries,
      appSlug: grailbabe?.slug ?? "grailbabe",
      appName: grailbabe?.displayName ?? "GrailBabe",
      capturedAt: new Date().toISOString(),
      appInsightsConfigured,
    };

    if (appInsightsConfigured) {
      cached = payload;
      cacheExpiresAt = now + CACHE_TTL_MS;
    }

    res.json(payload);
  } catch (err) {
    req.log.error(err, "GET /noc/api-dependencies failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
