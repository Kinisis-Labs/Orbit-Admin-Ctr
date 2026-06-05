/**
 * Budget overrun alert notifications.
 *
 * Sends a push notification (Microsoft Teams webhook and/or SMTP email) when an
 * app's end-of-month cost forecast crosses its budget cap.
 *
 * Completely opt-in — the scheduler only starts when at least one notification
 * channel is configured via env vars.  All channels are no-ops in dev unless
 * the relevant env vars are explicitly set.
 *
 * ## Env vars
 *
 * Teams (global or per-app):
 *   ALERT_TEAMS_WEBHOOK_URL              — global incoming-webhook URL
 *   ALERT_TEAMS_WEBHOOK_URL__<APPID>     — per-app override (upper-cased, hyphens → underscores)
 *                                          e.g. ALERT_TEAMS_WEBHOOK_URL__GRAILBABE
 *
 * SMTP email (global or per-app recipients):
 *   ALERT_SMTP_HOST                      — SMTP server hostname (required for email)
 *   ALERT_SMTP_PORT                      — port (default 587)
 *   ALERT_SMTP_USER                      — SMTP username
 *   ALERT_SMTP_PASS                      — SMTP password
 *   ALERT_SMTP_FROM                      — sender address (e.g. orbit@kinisislabs.com)
 *   ALERT_SMTP_SECURE                    — "true" for implicit TLS; default STARTTLS
 *   ALERT_EMAIL_TO                       — comma-separated recipient(s) for all apps
 *   ALERT_EMAIL_TO__<APPID>              — per-app recipient override
 *
 * Scheduler:
 *   ALERT_CHECK_INTERVAL_MINUTES         — polling cadence (default 60)
 *   ALERT_COOLDOWN_HOURS                 — min hours between repeat alerts per app (default 12)
 */

import nodemailer from "nodemailer";
import type { AppRecord } from "../routes/orbit.js";
import { APPS } from "../routes/orbit.js";
import { fetchMonthToDateCost } from "./azureCost.js";
import { fetchBudgetForAppWithFallback } from "./azureBudgets.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Normalise an app id into the env-var suffix form: upper-cased, hyphens → underscores. */
function appEnvKey(appId: string): string {
  return appId.toUpperCase().replace(/-/g, "_");
}

/** Teams webhook URL for an app: per-app override → global. */
function teamsWebhookUrl(appId: string): string | null {
  return (
    process.env[`ALERT_TEAMS_WEBHOOK_URL__${appEnvKey(appId)}`] ??
    process.env["ALERT_TEAMS_WEBHOOK_URL"] ??
    null
  );
}

/** Email recipients for an app: per-app override → global. Returns [] if unconfigured. */
function emailRecipients(appId: string): string[] {
  const raw =
    process.env[`ALERT_EMAIL_TO__${appEnvKey(appId)}`] ??
    process.env["ALERT_EMAIL_TO"] ??
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env["ALERT_SMTP_HOST"] &&
      process.env["ALERT_SMTP_FROM"] &&
      process.env["ALERT_EMAIL_TO"],
  );
}

function isTeamsConfiguredGlobally(): boolean {
  return Boolean(process.env["ALERT_TEAMS_WEBHOOK_URL"]);
}

function hasAnyTeamsConfig(): boolean {
  if (isTeamsConfiguredGlobally()) return true;
  return APPS.some((a) => Boolean(process.env[`ALERT_TEAMS_WEBHOOK_URL__${appEnvKey(a.id)}`]));
}

export function isBudgetAlertsConfigured(): boolean {
  return isSmtpConfigured() || hasAnyTeamsConfig();
}

// ---------------------------------------------------------------------------
// In-memory deduplication: appId → timestamp of last sent alert
// ---------------------------------------------------------------------------

const _lastAlertSentAt = new Map<string, number>();

function cooldownMs(): number {
  const hours = Number(process.env["ALERT_COOLDOWN_HOURS"] ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

function isOnCooldown(appId: string): boolean {
  const last = _lastAlertSentAt.get(appId);
  return last !== undefined && Date.now() - last < cooldownMs();
}

function markAlertSent(appId: string): void {
  _lastAlertSentAt.set(appId, Date.now());
}

// ---------------------------------------------------------------------------
// Notification payload
// ---------------------------------------------------------------------------

interface OverrunAlert {
  app: AppRecord;
  mtd: number;
  forecast: number;
  budget: number;
  overage: number;
  overagePct: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Teams (Adaptive Card via Incoming Webhook)
// ---------------------------------------------------------------------------

async function sendTeamsAlert(
  webhookUrl: string,
  alert: OverrunAlert,
): Promise<void> {
  const { app, mtd, forecast, budget, overage, overagePct } = alert;

  const body = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `🚨 Budget Overrun Forecast — ${app.name}`,
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: `The end-of-month forecast for **${app.name}** (${app.environment}) exceeds its budget cap.`,
              wrap: true,
              spacing: "Small",
            },
            {
              type: "FactSet",
              spacing: "Medium",
              facts: [
                { title: "Month-to-date spend", value: fmt(mtd) },
                { title: "End-of-month forecast", value: fmt(forecast) },
                { title: "Budget cap", value: fmt(budget) },
                {
                  title: "Overage",
                  value: `${fmt(overage)} (+${overagePct.toFixed(1)}% over budget)`,
                },
                { title: "Resource group", value: app.resourceGroup },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View in Orbit",
              url: `https://orbit.kinisislabs.com/apps/${app.id}/cost`,
            },
          ],
          msteams: { width: "Full" },
        },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Teams webhook returned ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// SMTP email via nodemailer
// ---------------------------------------------------------------------------

let _smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getSmtpTransport(): ReturnType<typeof nodemailer.createTransport> {
  if (!_smtpTransport) {
    const secure = process.env["ALERT_SMTP_SECURE"] === "true";
    _smtpTransport = nodemailer.createTransport({
      host: process.env["ALERT_SMTP_HOST"] ?? "",
      port: Number(process.env["ALERT_SMTP_PORT"] ?? (secure ? 465 : 587)),
      secure,
      ...(process.env["ALERT_SMTP_USER"]
        ? {
            auth: {
              user: process.env["ALERT_SMTP_USER"],
              pass: process.env["ALERT_SMTP_PASS"] ?? "",
            },
          }
        : {}),
    });
  }
  return _smtpTransport;
}

async function sendEmailAlert(
  recipients: string[],
  alert: OverrunAlert,
): Promise<void> {
  if (recipients.length === 0) return;

  const { app, mtd, forecast, budget, overage, overagePct } = alert;
  const from = process.env["ALERT_SMTP_FROM"] ?? "orbit@kinisislabs.com";
  const subject = `[Orbit] Budget overrun forecast — ${app.name} (${fmt(forecast)} / ${fmt(budget)})`;

  const html = `
<p>Hi team,</p>
<p>The end-of-month cost forecast for <strong>${app.name}</strong> (${app.environment}) has crossed its budget cap.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
  <tr><td style="font-weight:bold;padding-right:24px;">Month-to-date spend</td><td>${fmt(mtd)}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">End-of-month forecast</td><td>${fmt(forecast)}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Budget cap</td><td>${fmt(budget)}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Overage</td><td>${fmt(overage)} (+${overagePct.toFixed(1)}% over budget)</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Resource group</td><td>${app.resourceGroup}</td></tr>
</table>
<br>
<p><a href="https://orbit.kinisislabs.com/apps/${app.id}/cost">View cost details in Orbit →</a></p>
<p style="color:#888;font-size:12px;">This alert fires when forecast &gt; budget. It will not repeat for ${Math.round(cooldownMs() / 3_600_000)} hours.</p>
`;

  const text =
    `[Orbit] Budget overrun forecast — ${app.name}\n\n` +
    `Month-to-date spend : ${fmt(mtd)}\n` +
    `End-of-month forecast: ${fmt(forecast)}\n` +
    `Budget cap           : ${fmt(budget)}\n` +
    `Overage              : ${fmt(overage)} (+${overagePct.toFixed(1)}%)\n` +
    `Resource group       : ${app.resourceGroup}\n\n` +
    `View in Orbit: https://orbit.kinisislabs.com/apps/${app.id}/cost\n`;

  await getSmtpTransport().sendMail({ from, to: recipients.join(", "), subject, html, text });
}

// ---------------------------------------------------------------------------
// Core check logic
// ---------------------------------------------------------------------------

/**
 * Compute budget/forecast for a single app using the same fallback chain as
 * the cost route.  In mock mode (Azure unconfigured) these values are estimated
 * from the static inventory so the feature stays testable with real env vars
 * without needing live Azure data.
 */
async function resolveCostAndBudget(
  app: AppRecord,
): Promise<{ mtd: number; forecast: number; budget: number } | null> {
  const [liveCost, budgetWithSource] = await Promise.all([
    fetchMonthToDateCost(app, {}),
    fetchBudgetForAppWithFallback(app, {}),
  ]);

  const mtd = liveCost ? liveCost.monthToDate : app.monthToDateCost;

  // Budget: prefer live/cached Azure Budget; fall back to 2× MTD formula
  const budget = budgetWithSource?.result.amount ?? Number((mtd * 2.0).toFixed(2));

  // Forecast: prefer Azure Forecast API; fall back to 1.7× MTD formula
  // (mirror the same logic used in the cost route)
  const forecastMultiplier = !budgetWithSource && app.id === "orbit" ? 2.3 : 1.7;
  const forecast =
    budgetWithSource?.result.forecastAmount ?? Number((mtd * forecastMultiplier).toFixed(2));

  return { mtd, forecast, budget };
}

/**
 * Run a single pass over all tracked apps.  For each app whose forecast exceeds
 * its budget, send alert(s) on any configured channel — unless the app is on
 * cooldown (already alerted recently).
 *
 * Returns a summary of what was found and what was sent.
 */
export async function checkBudgetForecasts(): Promise<{
  checked: number;
  overruns: number;
  alertsSent: number;
  errors: number;
}> {
  let overruns = 0;
  let alertsSent = 0;
  let errors = 0;

  for (const app of APPS) {
    let resolved: { mtd: number; forecast: number; budget: number } | null = null;

    try {
      resolved = await resolveCostAndBudget(app);
    } catch (err) {
      logger.warn({ err, appId: app.id }, "budget-alert: failed to resolve cost/budget");
      errors++;
      continue;
    }

    if (!resolved) continue;

    const { mtd, forecast, budget } = resolved;
    if (forecast <= budget) continue;

    overruns++;
    const overage = Number((forecast - budget).toFixed(2));
    const overagePct = Number(((overage / budget) * 100).toFixed(1));
    const alert: OverrunAlert = { app, mtd, forecast, budget, overage, overagePct };

    logger.info(
      { appId: app.id, mtd, forecast, budget, overage },
      "budget-alert: forecast exceeds budget",
    );

    if (isOnCooldown(app.id)) {
      logger.debug({ appId: app.id }, "budget-alert: on cooldown, skipping notifications");
      continue;
    }

    let sentAny = false;

    // --- Teams ---
    const teamsUrl = teamsWebhookUrl(app.id);
    if (teamsUrl) {
      try {
        await sendTeamsAlert(teamsUrl, alert);
        logger.info({ appId: app.id }, "budget-alert: Teams notification sent");
        alertsSent++;
        sentAny = true;
      } catch (err) {
        logger.error({ err, appId: app.id }, "budget-alert: Teams notification failed");
        errors++;
      }
    }

    // --- Email ---
    const recipients = emailRecipients(app.id);
    if (isSmtpConfigured() && recipients.length > 0) {
      try {
        await sendEmailAlert(recipients, alert);
        logger.info({ appId: app.id, recipients }, "budget-alert: email notification sent");
        alertsSent++;
        sentAny = true;
      } catch (err) {
        logger.error({ err, appId: app.id }, "budget-alert: email notification failed");
        errors++;
      }
    }

    if (sentAny) markAlertSent(app.id);
  }

  return { checked: APPS.length, overruns, alertsSent, errors };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let _schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background budget-alert scheduler.
 *
 * No-op if no notification channel is configured, or if it is already running.
 * Safe to call at server startup — it logs what it does.
 */
export function startBudgetAlertScheduler(): void {
  if (_schedulerHandle !== null) return;

  if (!isBudgetAlertsConfigured()) {
    logger.info(
      "budget-alert: no notification channel configured (ALERT_TEAMS_WEBHOOK_URL / ALERT_SMTP_HOST+ALERT_EMAIL_TO) — scheduler not started",
    );
    return;
  }

  const intervalMinutes = Number(process.env["ALERT_CHECK_INTERVAL_MINUTES"] ?? 60);
  const intervalMs =
    Number.isFinite(intervalMinutes) && intervalMinutes > 0
      ? intervalMinutes * 60 * 1000
      : 60 * 60 * 1000;

  logger.info(
    { intervalMinutes: intervalMs / 60_000, cooldownHours: cooldownMs() / 3_600_000 },
    "budget-alert: scheduler started",
  );

  const run = async (): Promise<void> => {
    try {
      const result = await checkBudgetForecasts();
      logger.info(result, "budget-alert: check complete");
    } catch (err) {
      logger.error({ err }, "budget-alert: unexpected error during check");
    }
  };

  // Run immediately on startup, then on every interval
  void run();
  _schedulerHandle = setInterval(() => void run(), intervalMs);
  // Don't hold the Node.js event loop open — the interval is background work
  _schedulerHandle.unref();
}

/** Stop the scheduler (primarily for tests). */
export function stopBudgetAlertScheduler(): void {
  if (_schedulerHandle !== null) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
  }
}
