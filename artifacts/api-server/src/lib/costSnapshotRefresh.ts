/**
 * Background cost-snapshot refresh loop.
 *
 * Proactively calls `fetchMonthToDateCostWithFallback` for every tracked app
 * on a configurable interval so the DB snapshot is always recent — even when
 * no operator requests come in overnight.
 *
 * Design goals:
 *  - No-op in mock/dev mode: exits immediately when `isAzureConfigured()`
 *    returns false.
 *  - Non-fatal on Azure errors: logs a warning per-app and moves on.
 *  - Interval is just under the 30-minute in-process cache TTL so each tick
 *    bypasses the cache and hits Azure (or falls through to the DB snapshot).
 *  - Interval is re-read from Azure App Configuration before each tick so it
 *    can be changed without redeploying.
 *
 * Resolution order for the interval:
 *   1. Azure App Configuration key `COST_REFRESH_INTERVAL_MINUTES`
 *      (live, no redeploy needed — requires `APP_CONFIGURATION_ENDPOINT`)
 *   2. Env var `COST_REFRESH_INTERVAL_MINUTES`
 *   3. Built-in default (25 min)
 */

import { isAzureConfigured } from "./azure.js";
import { getAppConfigSetting } from "./appConfig.js";
import { fetchMonthToDateCostWithFallback } from "./azureCost.js";
import { logger } from "./logger.js";
import { APPS, billingScope } from "../routes/orbit.js";

const DEFAULT_INTERVAL_MINUTES = 25;
const APP_CONFIG_KEY = "COST_REFRESH_INTERVAL_MINUTES";

function parseMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Returns the refresh interval in milliseconds.
 *
 * Checks Azure App Configuration first (live value), then the env var, then
 * falls back to the built-in default. Non-fatal: any App Configuration error
 * is already logged inside `getAppConfigSetting`.
 */
async function getIntervalMs(): Promise<number> {
  const appConfigRaw = await getAppConfigSetting(APP_CONFIG_KEY);
  const fromAppConfig = parseMinutes(appConfigRaw);
  if (fromAppConfig !== null) {
    return fromAppConfig * 60 * 1000;
  }

  const fromEnv = parseMinutes(process.env.COST_REFRESH_INTERVAL_MINUTES);
  const minutes = fromEnv ?? DEFAULT_INTERVAL_MINUTES;
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

/**
 * Schedules the next refresh tick via setTimeout.
 *
 * Using setTimeout (rather than setInterval) lets us re-read the configured
 * interval before each tick, so changes in App Configuration take effect
 * within one cycle — no redeploy required.
 */
async function scheduleNextTick(): Promise<void> {
  const intervalMs = await getIntervalMs();
  logger.debug(
    { intervalMinutes: intervalMs / 60_000 },
    "cost snapshot refresh: next tick scheduled",
  );
  setTimeout(() => {
    refreshAllSnapshots()
      .catch((err) => {
        logger.warn({ err }, "cost snapshot background refresh loop error (non-fatal)");
      })
      .finally(() => {
        scheduleNextTick().catch((err) => {
          logger.warn({ err }, "cost snapshot: failed to schedule next tick (non-fatal)");
        });
      });
  }, intervalMs);
}

export async function startCostSnapshotRefresh(): Promise<void> {
  if (!isAzureConfigured()) {
    logger.info("Azure not configured — cost snapshot background refresh skipped");
    return;
  }

  const intervalMs = await getIntervalMs();
  logger.info(
    { intervalMinutes: intervalMs / 60_000, appCount: APPS.length },
    "Starting cost snapshot background refresh",
  );

  setTimeout(() => {
    refreshAllSnapshots()
      .catch((err) => {
        logger.warn({ err }, "cost snapshot background refresh loop error (non-fatal)");
      })
      .finally(() => {
        scheduleNextTick().catch((err) => {
          logger.warn({ err }, "cost snapshot: failed to schedule next tick (non-fatal)");
        });
      });
  }, intervalMs);
}
