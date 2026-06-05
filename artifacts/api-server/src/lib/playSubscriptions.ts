import { logger } from "./logger";
import { playApps, type AppRecord } from "../routes/orbit";

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

// The real Google Play connection activates only when all of these are present,
// exactly like isEntraConfigured() gates real staff sign-in. Until then the
// surface runs on placeholder data. These get set when keyless Workload Identity
// Federation to the Play Developer APIs is provisioned.
const PLAY_ENV = [
  "GOOGLE_PLAY_SA_EMAIL",
  "GOOGLE_PLAY_WIF_AUDIENCE",
  "GOOGLE_PLAY_DEVELOPER_ID",
] as const;

export function isPlayConfigured(): boolean {
  return PLAY_ENV.every((k) => {
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

const AVG_PRICE = 7.99; // blended monthly subscription price (USD), placeholder

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

// Real ingestion seam. When keyless WIF + the Play Developer / Android Publisher
// APIs are wired, this pulls live subscriber states (RTDN-backed) and revenue
// (earnings reports). Not implemented yet — it deliberately throws so the caller
// falls back to placeholder data instead of silently serving fake "live" rows.
async function fetchLivePlaySubscriptions(): Promise<PlaySubscriptionRow[]> {
  throw new Error("Google Play live ingestion not implemented yet");
}

// Aggregate per-app Google Play subscription metrics for the tracked Android
// apps. Auto-activates the real feed once configured; falls back to placeholder.
export async function getPlaySubscriptions(): Promise<PlaySubscriptionRow[]> {
  if (isPlayConfigured()) {
    try {
      return await fetchLivePlaySubscriptions();
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "Google Play configured but live ingestion failed; serving placeholder data",
      );
    }
  }
  return playApps().map(placeholderRow);
}
