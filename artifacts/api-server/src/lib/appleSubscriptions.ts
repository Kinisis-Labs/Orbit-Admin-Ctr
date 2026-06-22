import { logger } from "./logger";
import { appStoreApps, type AppRecord } from "../routes/orbit";

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

// Anonymous, aggregate Apple App Store subscription metrics per tracked iOS app.
// Mirrors the Play subscriptions pattern: a config-gated real connection that,
// until provisioned, serves stable placeholder data so the dashboard stays
// meaningful. The real path uses App Store Connect API (JWT-authenticated with
// a .p8 private key — single-download from App Store Connect, store securely).

export type AppleSubscriptionRow = {
  appId: string;
  appName: string;
  environment: string;
  bundleId: string;
  appleAppId?: string;
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

// The real RevenueCat connection activates when the Apple API key is configured.
// This replaces the App Store Connect API approach with direct RevenueCat integration.
export function isAppleConfigured(): boolean {
  const apiKey = process.env.REVENUECAT_API_KEY_APPL;
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

const AVG_PRICE = 8.99; // blended monthly subscription price (USD), placeholder (App Store pricing tier)

function placeholderRow(app: AppRecord): AppleSubscriptionRow {
  const rand = seededRand(app.id + "apple");
  // Dev/test environments carry a tiny tester cohort; prod a larger base.
  const base = app.environment === "prod" ? 510 : 8;
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
    bundleId: app.iosBundle ?? "",
    ...(app.appleAppId ? { appleAppId: app.appleAppId } : {}),
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

// Real RevenueCat API integration for Apple subscriptions.
// Pulls live subscriber states and revenue from RevenueCat API.
async function fetchLiveAppleSubscriptions(): Promise<AppleSubscriptionRow[]> {
  const REVENUECAT_API_KEY_APPL = process.env.REVENUECAT_API_KEY_APPL;
  if (!REVENUECAT_API_KEY_APPL) {
    throw new Error("REVENUECAT_API_KEY_APPL not configured");
  }

  const apps = appStoreApps();
  const results: AppleSubscriptionRow[] = [];

  for (const app of apps) {
    if (!app.iosBundle) continue;

    try {
      // Fetch subscriber metrics from RevenueCat
      const metricsUrl = `https://api.revenuecat.com/v1/apps/${app.iosBundle}/metrics`;
      const metricsResponse = await fetch(metricsUrl, {
        headers: {
          'Authorization': `Bearer ${REVENUECAT_API_KEY_APPL}`,
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
      const revenueUrl = `https://api.revenuecat.com/v1/apps/${app.iosBundle}/revenue?period=30d`;
      const revenueResponse = await fetch(revenueUrl, {
        headers: {
          'Authorization': `Bearer ${REVENUECAT_API_KEY_APPL}`,
          'Content-Type': 'application/json',
        },
      });

      let revenueLast30d = 0;
      if (revenueResponse.ok) {
        const revenueData = await revenueResponse.json() as RevenueCatRevenue;
        revenueLast30d = revenueData.total || 0;
      }

      // Transform RevenueCat data to our format
      const row: AppleSubscriptionRow = {
        appId: app.id,
        appName: app.name,
        environment: app.environment,
        bundleId: app.iosBundle,
        ...(app.appleAppId ? { appleAppId: app.appleAppId } : {}),
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
// banner. Mirrors the playSubscriptions cache pattern.
type Snapshot = { rows: AppleSubscriptionRow[]; fetchedAt: string };
let snapshot: Snapshot | null = null;

// Aggregate per-app Apple App Store subscription metrics for the tracked iOS
// apps. Auto-activates the real feed once configured; falls back to the last
// snapshot (cached) and finally to an empty array when no snapshot is available.
export async function getAppleSubscriptions(): Promise<AppleSubscriptionRow[]> {
  if (isAppleConfigured()) {
    try {
      const rows = await fetchLiveAppleSubscriptions();
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
