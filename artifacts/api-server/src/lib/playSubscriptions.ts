import { logger } from "./logger";
import { playApps, type AppRecord } from "../routes/orbit";

// RevenueCat API response types
interface RevenueCatMetrics {
  active_subscribers: number;
  canceled_subscribers: number;
  expired_subscribers: number;
  monthly_recurring_revenue: number;
  active_subscribers_trend_percent: number;
}

interface RevenueCatRevenue {
  total: number;
}

// Anonymous, aggregate Google Play subscription metrics per tracked Android app.
// Mirrors the Clerk-activity / Entra patterns: a config-gated real connection
// that, until provisioned, serves stable placeholder data so the dashboard stays
// meaningful. GrailBabe is in Play testing (not yet live), so there is no real
// subscriber/revenue feed yet — and org policy blocks JSON service-account keys,
// so the real path is keyless Workload Identity Federation, wired in later.

export type PlaySubscriptionRow = {
  appId: string;
  appName: string;
  environment: string;
  packageName: string;
  playAppId?: string;
  playDeveloperId?: string;
  activeSubscribers: number;
  canceledSubscribers: number;
  expiredSubscribers: number;
  mrr: number;
  revenueLast30d: number;
  currency: string;
  activeTrendPct: number;
  dataSource: "placeholder" | "live" | "cached";
  dataAsOf?: string;
};

// The real RevenueCat connection activates when the Google API key is configured.
// This replaces the Google Play Developer API approach with direct RevenueCat integration.
export function isPlayConfigured(): boolean {
  const apiKey = process.env.REVENUECAT_API_KEY_GOOG;
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

// Deterministic pseudo-random so placeholder figures stay stable across requests
// while still varying per app.
function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AVG_PRICE = 7.99; // blended monthly subscription price (USD), placeholder

function playConsoleIds(app: AppRecord): { playAppId?: string; playDeveloperId?: string } {
  const playAppId = app.playAppId ?? undefined;
  const developerId = process.env.GOOGLE_PLAY_DEVELOPER_ID?.trim() || undefined;
  if (!playAppId) return {};
  return { playAppId, ...(developerId ? { playDeveloperId: developerId } : {}) };
}

function placeholderRow(app: AppRecord): PlaySubscriptionRow {
  const rand = seededRand(app.id + "play");
  // Dev/test environments carry a tiny tester cohort; prod a larger base.
  const base = app.environment === "prod" ? 420 : 6;
  const active = Math.round(base * (0.7 + rand() * 0.9));
  const canceled = Math.round(active * (0.08 + rand() * 0.07));
  const expired = Math.round(active * (0.4 + rand() * 0.6));
  const mrr = Number((active * AVG_PRICE).toFixed(2));
  const revenueLast30d = Number((mrr * (0.92 + rand() * 0.16)).toFixed(2));
  const activeTrendPct = Number(((rand() - 0.35) * 28).toFixed(1));
  return {
    appId: app.id,
    appName: app.name,
    environment: app.environment,
    packageName: app.androidPackage ?? "",
    ...playConsoleIds(app),
    activeSubscribers: active,
    canceledSubscribers: canceled,
    expiredSubscribers: expired,
    mrr,
    revenueLast30d,
    currency: "USD",
    activeTrendPct,
    dataSource: "placeholder",
  };
}

// Real RevenueCat API integration for Google Play subscriptions.
// Pulls live subscriber states and revenue from RevenueCat API.
async function fetchLivePlaySubscriptions(): Promise<PlaySubscriptionRow[]> {
  const REVENUECAT_API_KEY_GOOG = process.env.REVENUECAT_API_KEY_GOOG;
  if (!REVENUECAT_API_KEY_GOOG) {
    throw new Error("REVENUECAT_API_KEY_GOOG not configured");
  }

  const apps = playApps();
  const results: PlaySubscriptionRow[] = [];

  for (const app of apps) {
    if (!app.androidPackage) continue;

    try {
      // Fetch subscriber metrics from RevenueCat
      const metricsUrl = `https://api.revenuecat.com/v1/apps/${app.androidPackage}/metrics`;
      const metricsResponse = await fetch(metricsUrl, {
        headers: {
          'Authorization': `Bearer ${REVENUECAT_API_KEY_GOOG}`,
          'Content-Type': 'application/json',
        },
      });

      if (!metricsResponse.ok) {
        logger.warn(
          { app: app.id, status: metricsResponse.status },
          "Failed to fetch RevenueCat metrics for app"
        );
        continue;
      }

      const metricsData = await metricsResponse.json() as RevenueCatMetrics;
      
      // Fetch revenue data from RevenueCat
      const revenueUrl = `https://api.revenuecat.com/v1/apps/${app.androidPackage}/revenue?period=30d`;
      const revenueResponse = await fetch(revenueUrl, {
        headers: {
          'Authorization': `Bearer ${REVENUECAT_API_KEY_GOOG}`,
          'Content-Type': 'application/json',
        },
      });

      let revenueLast30d = 0;
      if (revenueResponse.ok) {
        const revenueData = await revenueResponse.json() as RevenueCatRevenue;
        revenueLast30d = revenueData.total || 0;
      }

      // Get Play console IDs
      const playIds = playConsoleIds(app);

      // Transform RevenueCat data to our format
      const row: PlaySubscriptionRow = {
        appId: app.id,
        appName: app.name,
        environment: app.environment,
        packageName: app.androidPackage,
        ...playIds,
        activeSubscribers: metricsData.active_subscribers || 0,
        canceledSubscribers: metricsData.canceled_subscribers || 0,
        expiredSubscribers: metricsData.expired_subscribers || 0,
        mrr: metricsData.monthly_recurring_revenue || 0,
        revenueLast30d,
        currency: "USD",
        activeTrendPct: metricsData.active_subscribers_trend_percent || 0,
        dataSource: "live",
        dataAsOf: new Date().toISOString(),
      };

      results.push(row);
    } catch (error) {
      logger.warn(
        { app: app.id, error: (error as Error).message },
        "Error fetching RevenueCat data for app"
      );
      continue;
    }
  }

  return results;
}

// In-memory snapshot of the last successful live fetch. If a subsequent live
// fetch fails, the cached rows are returned with dataSource: "cached" and
// dataAsOf set to the snapshot timestamp so the frontend can surface a staleness
// banner. Mirrors the appleSubscriptions cache pattern.
type Snapshot = { rows: PlaySubscriptionRow[]; fetchedAt: string };
let snapshot: Snapshot | null = null;

// Aggregate per-app Google Play subscription metrics for the tracked Android
// apps. Auto-activates the real feed once configured; falls back to the last
// snapshot (cached) and finally to an empty array when no snapshot is available.
export async function getPlaySubscriptions(): Promise<PlaySubscriptionRow[]> {
  if (isPlayConfigured()) {
    try {
      const rows = await fetchLivePlaySubscriptions();
      snapshot = { rows, fetchedAt: new Date().toISOString() };
      return rows;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "RevenueCat configured but live ingestion failed; serving cached snapshot if available",
      );
      if (snapshot) {
        return snapshot.rows.map((r) => ({
          ...r,
          dataSource: "cached" as const,
          dataAsOf: snapshot!.fetchedAt,
        }));
      }
    }
  }
  // Return empty array when not configured - no placeholder data
  return [];
}
