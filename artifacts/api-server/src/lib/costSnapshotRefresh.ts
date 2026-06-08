/**
 * Background cost-snapshot refresh loop.
 *
 * Proactively calls `fetchMonthToDateCostWithFallback` for every tracked app
 * on a fixed interval so the DB snapshot is always recent — even when no
 * operator requests come in overnight.
 *
 * Design goals:
 *  - No-op in mock/dev mode: exits immediately when `isAzureConfigured()`
 *    returns false.
 *  - Non-fatal on Azure errors: logs a warning per-app and moves on.
 *  - Interval is just under the 30-minute in-process cache TTL so each tick
 *    bypasses the cache and hits Azure (or falls through to the DB snapshot).
 *
 * Env tuning (optional):
 *   COST_REFRESH_INTERVAL_MINUTES — polling cadence in minutes (default 25)
 */

import { isAzureConfigured } from "./azure.js";
import { fetchMonthToDateCostWithFallback } from "./azureCost.js";
import { logger } from "./logger.js";
import { APPS, billingScope } from "../routes/orbit.js";

const DEFAULT_INTERVAL_MINUTES = 25;

function getIntervalMs(): number {
  const raw = process.env.COST_REFRESH_INTERVAL_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES;
  return minutes * 60 * 1000;
}

async function refreshAllSnapshots(): Promise<void> {
  for (const app of APPS) {
    try {
      await fetchMonthToDateCostWithFallback(app, {
        bypassCache: true,
        billingScope: billingScope(app.id),
      });
    } catch (err) {
      logger.warn({ err, appId: app.id }, "cost snapshot background refresh failed (non-fatal)");
    }
  }
}

export function startCostSnapshotRefresh(): void {
  if (!isAzureConfigured()) {
    logger.info("Azure not configured — cost snapshot background refresh skipped");
    return;
  }

  const intervalMs = getIntervalMs();
  logger.info(
    { intervalMinutes: intervalMs / 60_000, appCount: APPS.length },
    "Starting cost snapshot background refresh",
  );

  setInterval(() => {
    refreshAllSnapshots().catch((err) => {
      logger.warn({ err }, "cost snapshot background refresh loop error (non-fatal)");
    });
  }, intervalMs);
}
