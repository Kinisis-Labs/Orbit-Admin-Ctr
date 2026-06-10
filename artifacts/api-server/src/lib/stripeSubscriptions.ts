import { getStripeClient, isStripeConfigured } from "./stripeClient.js";
import { APPS } from "../routes/orbit.js";
import { logger } from "./logger.js";

export interface StripeSubscriptionRow {
  appId: string;
  appName: string;
  environment: string;
  activeSubscribers: number;
  trialingSubscribers: number;
  canceledSubscribers: number;
  pastDueSubscribers: number;
  mrr: number;
  revenueLast30d: number;
  currency: string;
  activeTrendPct: number;
  dataSource: "placeholder" | "live" | "cached";
  dataAsOf?: string;
  stripeDashboardUrl?: string;
}

// Deterministic placeholder generator so the surface looks reasonable
// without live credentials. Same seed pattern as Apple/Play.
function placeholderFor(appId: string): StripeSubscriptionRow {
  const hash = [...appId].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7);
  const active = 40 + (Math.abs(hash) % 120);
  const trialing = 5 + (Math.abs(hash * 13) % 20);
  const canceled = 3 + (Math.abs(hash * 7) % 15);
  const pastDue = Math.abs(hash * 3) % 8;
  const mrr = active * (4.99 + (Math.abs(hash) % 10));
  const revenue30d = mrr * (0.85 + (Math.abs(hash) % 30) / 100);
  const trend = ((Math.abs(hash) % 20) - 7) * 0.5;
  const app = APPS.find((a) => a.id === appId);
  return {
    appId,
    appName: app?.name ?? appId,
    environment: "production",
    activeSubscribers: active,
    trialingSubscribers: trialing,
    canceledSubscribers: canceled,
    pastDueSubscribers: pastDue,
    mrr: Math.round(mrr * 100) / 100,
    revenueLast30d: Math.round(revenue30d * 100) / 100,
    currency: "USD",
    activeTrendPct: Math.round(trend * 10) / 10,
    dataSource: "placeholder",
  };
}

// Normalises a Stripe subscription amount to monthly USD cents.
// Stripe prices can be weekly / monthly / yearly etc.
function toMonthlyCents(amount: number, interval: string, intervalCount: number): number {
  switch (interval) {
    case "day":   return (amount / intervalCount) * 30;
    case "week":  return (amount / intervalCount) * 4.333;
    case "month": return amount / intervalCount;
    case "year":  return amount / (intervalCount * 12);
    default:      return amount;
  }
}

// Fetch live Stripe subscription metrics. Only called when isStripeConfigured().
async function fetchLiveStripeSubscriptions(appId: string): Promise<StripeSubscriptionRow> {
  const stripe = getStripeClient();
  const app = APPS.find((a) => a.id === appId);
  const appName = app?.name ?? appId;

  let activeSubscribers = 0;
  let trialingSubscribers = 0;
  let canceledSubscribers = 0;
  let pastDueSubscribers = 0;
  let mrrCents = 0;

  // Count current subscriptions by status.
  for await (const sub of stripe.subscriptions.list({ limit: 100, status: "all", expand: ["data.items.data.price"] })) {
    switch (sub.status) {
      case "active":
        activeSubscribers++;
        for (const item of sub.items.data) {
          const price = item.price;
          if (price && price.unit_amount && price.recurring) {
            mrrCents += toMonthlyCents(
              price.unit_amount * (item.quantity ?? 1),
              price.recurring.interval,
              price.recurring.interval_count,
            );
          }
        }
        break;
      case "trialing":
        trialingSubscribers++;
        break;
      case "past_due":
        pastDueSubscribers++;
        break;
      case "canceled":
        canceledSubscribers++;
        break;
    }
  }

  // Revenue last 30 days from succeeded invoices paid in the window.
  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  let revenue30dCents = 0;
  for await (const inv of stripe.invoices.list({ limit: 100, status: "paid", created: { gte: since } })) {
    revenue30dCents += inv.amount_paid ?? 0;
  }

  const mrr = Math.round(mrrCents) / 100;
  const revenueLast30d = Math.round(revenue30dCents) / 100;
  const activeTrendPct = 0; // trend requires historical snapshot — deferred

  return {
    appId,
    appName,
    environment: "production",
    activeSubscribers,
    trialingSubscribers,
    canceledSubscribers,
    pastDueSubscribers,
    mrr,
    revenueLast30d,
    currency: "USD",
    activeTrendPct,
    dataSource: "live",
    dataAsOf: new Date().toISOString(),
    stripeDashboardUrl: "https://dashboard.stripe.com/subscriptions",
  };
}

// stripeApps returns the app IDs that should appear on this surface.
// Currently scoped to GrailBabe (prod) only, mirroring the Stripe sync policy.
function stripeApps(): string[] {
  return APPS.filter((a) => a.environment === "prod" && a.id === "grailbabe").map((a) => a.id);
}

export async function getStripeSubscriptions(): Promise<StripeSubscriptionRow[]> {
  const appIds = stripeApps();
  if (!isStripeConfigured()) {
    return appIds.map(placeholderFor);
  }

  const results: StripeSubscriptionRow[] = [];
  for (const appId of appIds) {
    try {
      results.push(await fetchLiveStripeSubscriptions(appId));
    } catch (err) {
      logger.warn({ err, appId }, "stripe-subscriptions: falling back to placeholder");
      results.push(placeholderFor(appId));
    }
  }
  return results;
}
