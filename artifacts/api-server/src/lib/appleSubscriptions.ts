import { logger } from "./logger";
import { appStoreApps, type AppRecord } from "../routes/orbit";

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

// The real App Store Connect connection activates only when all of these are
// present, exactly like isEntraConfigured() gates real staff sign-in and
// isPlayConfigured() gates Play data. Until provisioned, placeholder data is served.
//
// APPLE_CONNECT_ISSUER_ID   — Issuer ID from App Store Connect → Users and Access → Keys
// APPLE_CONNECT_KEY_ID      — Key ID of the .p8 API key
// APPLE_CONNECT_PRIVATE_KEY — Contents of the .p8 file (PEM string, single-download)
const APPLE_ENV = [
  "APPLE_CONNECT_ISSUER_ID",
  "APPLE_CONNECT_KEY_ID",
  "APPLE_CONNECT_PRIVATE_KEY",
] as const;

export function isAppleConfigured(): boolean {
  return APPLE_ENV.every((k) => {
    const v = process.env[k];
    return typeof v === "string" && v.trim().length > 0;
  });
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

// Real ingestion seam. When App Store Connect API credentials are provisioned,
// this will pull live subscriber states and revenue. Not implemented yet — it
// deliberately throws so the caller falls back to placeholder data instead of
// silently serving fake "live" rows.
async function fetchLiveAppleSubscriptions(): Promise<AppleSubscriptionRow[]> {
  throw new Error("App Store Connect live ingestion not implemented yet");
}

// Aggregate per-app Apple App Store subscription metrics for the tracked iOS
// apps. Auto-activates the real feed once configured; falls back to placeholder.
export async function getAppleSubscriptions(): Promise<AppleSubscriptionRow[]> {
  if (isAppleConfigured()) {
    try {
      return await fetchLiveAppleSubscriptions();
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "App Store Connect configured but live ingestion failed; serving placeholder data",
      );
    }
  }
  return appStoreApps().map(placeholderRow);
}
