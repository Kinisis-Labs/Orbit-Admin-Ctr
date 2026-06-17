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
  dataSource: "live" | "cached";
  dataAsOf?: string;
  stripeDashboardUrl?: string;
}

// Normalises a Stripe subscription amount to monthly USD cents.
function toMonthlyCents(amount: number, interval: string, intervalCount: number): number {
  switch (interval) {
    case "day":   return (amount / intervalCount) * 30;
    case "week":  return (amount / intervalCount) * 4.333;
    case "month": return amount / intervalCount;
    case "year":  return amount / (intervalCount * 12);
    default:      return amount;
  }
}

// Fetch live Stripe subscription metrics for a single app.
async function fetchLiveStripeSubscriptions(appId: string): Promise<StripeSubscriptionRow> {
  const stripe = getStripeClient();
  const app = APPS.find((a) => a.id === appId);
  const appName = app?.name ?? appId;

  let activeSubscribers = 0;
  let trialingSubscribers = 0;
  let canceledSubscribers = 0;
  let pastDueSubscribers = 0;
  let mrrCents = 0;

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

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  let revenue30dCents = 0;
  for await (const inv of stripe.invoices.list({ limit: 100, status: "paid", created: { gte: since } })) {
    revenue30dCents += inv.amount_paid ?? 0;
  }

  return {
    appId,
    appName,
    environment: "production",
    activeSubscribers,
    trialingSubscribers,
    canceledSubscribers,
    pastDueSubscribers,
    mrr: Math.round(mrrCents) / 100,
    revenueLast30d: Math.round(revenue30dCents) / 100,
    currency: "USD",
    activeTrendPct: 0, // trend requires historical snapshot — deferred
    dataSource: "live",
    dataAsOf: new Date().toISOString().replace(/Z$/, "+00:00"),
    stripeDashboardUrl: "https://dashboard.stripe.com/subscriptions",
  };
}

// stripeApps returns the app IDs that should appear on this surface.
function stripeApps(): string[] {
  return APPS.filter((a) => a.environment === "prod" && a.id === "grailbabe").map((a) => a.id);
}

export async function getStripeSubscriptions(): Promise<StripeSubscriptionRow[]> {
  if (!isStripeConfigured()) return [];

  const results: StripeSubscriptionRow[] = [];
  for (const appId of stripeApps()) {
    try {
      results.push(await fetchLiveStripeSubscriptions(appId));
    } catch (err) {
      logger.error({ err, appId }, "stripe-subscriptions: live fetch failed");
    }
  }
  return results;
}
