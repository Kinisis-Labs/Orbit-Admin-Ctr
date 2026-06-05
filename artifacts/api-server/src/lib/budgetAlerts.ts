/**
 * Budget overrun + infra-pressure alert notifications.
 *
 * Sends push notifications (Microsoft Teams webhook and/or SMTP email) when:
 *   1. An app's end-of-month cost forecast crosses its budget cap.
 *   2. An app's CPU or memory stays above a configurable threshold for
 *      N consecutive scheduler checks (default: 2 consecutive checks).
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
 *   ALERT_COOLDOWN_HOURS__<APPID>        — per-app override (upper-cased, hyphens → underscores)
 *                                          e.g. ALERT_COOLDOWN_HOURS__GRAILBABE=24
 *
 * Infra thresholds:
 *   Resolution order (highest → lowest priority) for CPU and memory thresholds:
 *     1. ALERT_CPU_THRESHOLD_PCT__<APPID>  — per-app env-var override
 *     2. app.cpuThreshold                  — APPS inventory baseline (set per app in orbit.ts)
 *     3. ALERT_CPU_THRESHOLD_PCT           — global env var (default 80)
 *
 *   ALERT_CPU_THRESHOLD_PCT              — CPU % above which an alert fires (default 80)
 *   ALERT_CPU_THRESHOLD_PCT__<APPID>     — per-app override (upper-cased, hyphens → underscores)
 *                                          e.g. ALERT_CPU_THRESHOLD_PCT__GRAILBABE=90
 *
 *   Resolution order for memory thresholds mirrors CPU (same three tiers):
 *   ALERT_MEMORY_THRESHOLD_PCT           — Memory % above which an alert fires (default 85)
 *   ALERT_MEMORY_THRESHOLD_PCT__<APPID>  — per-app override
 *                                          e.g. ALERT_MEMORY_THRESHOLD_PCT__ORBIT=70
 *   ALERT_INFRA_CONSECUTIVE_CHECKS               — number of consecutive over-threshold checks required
 *                                                  before a notification is dispatched (default 2)
 *   ALERT_INFRA_CONSECUTIVE_CHECKS__<APPID>      — per-app override (upper-cased, hyphens → underscores)
 *                                                  e.g. ALERT_INFRA_CONSECUTIVE_CHECKS__GRAILBABE=4
 */

import nodemailer from "nodemailer";
import type { AppRecord } from "../routes/orbit.js";
import { APPS } from "../routes/orbit.js";
import { fetchMonthToDateCost } from "./azureCost.js";
import { fetchBudgetForAppWithFallback } from "./azureBudgets.js";
import { fetchAppTimeSeries } from "./azureMonitor.js";
import { logger } from "./logger.js";
import { db, budgetAlertLogTable, infraAlertLogTable } from "@workspace/db";

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

/**
 * CPU threshold percent for an app.
 *
 * Resolution order (highest → lowest priority):
 *   1. ALERT_CPU_THRESHOLD_PCT__<APPID>  per-app env-var override
 *   2. app.cpuThreshold                  APPS inventory baseline
 *   3. ALERT_CPU_THRESHOLD_PCT           global env var
 *   4. 80                                hardcoded default
 */
function cpuThresholdPct(appId?: string): number {
  if (appId) {
    const perAppEnv = process.env[`ALERT_CPU_THRESHOLD_PCT__${appEnvKey(appId)}`];
    if (perAppEnv !== undefined) {
      const v = Number(perAppEnv);
      if (Number.isFinite(v) && v > 0 && v <= 100) return v;
    }
    const inventoryThreshold = APPS.find((a) => a.id === appId)?.cpuThreshold;
    if (inventoryThreshold !== undefined) return inventoryThreshold;
  }
  const raw = process.env["ALERT_CPU_THRESHOLD_PCT"] ?? "80";
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 80;
}

/**
 * Memory threshold percent for an app.
 *
 * Resolution order (highest → lowest priority):
 *   1. ALERT_MEMORY_THRESHOLD_PCT__<APPID>  per-app env-var override
 *   2. app.memoryThreshold                  APPS inventory baseline
 *   3. ALERT_MEMORY_THRESHOLD_PCT           global env var
 *   4. 85                                   hardcoded default
 */
function memoryThresholdPct(appId?: string): number {
  if (appId) {
    const perAppEnv = process.env[`ALERT_MEMORY_THRESHOLD_PCT__${appEnvKey(appId)}`];
    if (perAppEnv !== undefined) {
      const v = Number(perAppEnv);
      if (Number.isFinite(v) && v > 0 && v <= 100) return v;
    }
    const inventoryThreshold = APPS.find((a) => a.id === appId)?.memoryThreshold;
    if (inventoryThreshold !== undefined) return inventoryThreshold;
  }
  const raw = process.env["ALERT_MEMORY_THRESHOLD_PCT"] ?? "85";
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 85;
}

/**
 * Number of consecutive over-threshold scheduler checks required before a
 * notification fires (default 2).  A single transient spike will not alert.
 *
 * Per-app override via ALERT_INFRA_CONSECUTIVE_CHECKS__<APPID> takes
 * precedence over the global ALERT_INFRA_CONSECUTIVE_CHECKS value.
 */
function infraConsecutiveChecksRequired(appId?: string): number {
  const raw =
    (appId ? process.env[`ALERT_INFRA_CONSECUTIVE_CHECKS__${appEnvKey(appId)}`] : undefined) ??
    process.env["ALERT_INFRA_CONSECUTIVE_CHECKS"] ??
    "2";
  const v = Number(raw);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2;
}

// ---------------------------------------------------------------------------
// In-memory deduplication: appId → timestamp of last sent alert
// Budget and infra use separate maps so they don't share cooldown state.
// Infra uses "<appId>:<metric>" keys (e.g. "grailbabe:cpu").
// ---------------------------------------------------------------------------

const _lastBudgetAlertSentAt = new Map<string, number>();
const _lastInfraAlertSentAt = new Map<string, number>();

/**
 * Consecutive over-threshold reading count per "<appId>:<metric>".
 * Incremented each check cycle the metric is above threshold; reset to 0 when
 * the metric is at or below threshold.
 */
const _infraConsecutiveCounts = new Map<string, number>();

function cooldownMs(appId?: string): number {
  const raw =
    (appId ? process.env[`ALERT_COOLDOWN_HOURS__${appEnvKey(appId)}`] : undefined) ??
    process.env["ALERT_COOLDOWN_HOURS"] ??
    "12";
  const hours = Number(raw);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

function isBudgetOnCooldown(appId: string): boolean {
  const last = _lastBudgetAlertSentAt.get(appId);
  return last !== undefined && Date.now() - last < cooldownMs(appId);
}

function isInfraOnCooldown(appId: string, metric: string): boolean {
  const key = `${appId}:${metric}`;
  const last = _lastInfraAlertSentAt.get(key);
  return last !== undefined && Date.now() - last < cooldownMs(appId);
}

function markBudgetAlertSent(
  appId: string,
  alert: OverrunAlert,
  channels: string[],
): void {
  _lastBudgetAlertSentAt.set(appId, Date.now());

  db.insert(budgetAlertLogTable)
    .values({
      appId,
      mtd: String(alert.mtd),
      forecast: String(alert.forecast),
      budget: String(alert.budget),
      channels: channels.join(","),
    })
    .catch((err: unknown) => {
      logger.error({ err, appId }, "budget-alert: failed to persist alert log row");
    });
}

function markInfraAlertSent(
  appId: string,
  metric: string,
  value: number,
  threshold: number,
  channels: string[],
): void {
  const key = `${appId}:${metric}`;
  _lastInfraAlertSentAt.set(key, Date.now());

  db.insert(infraAlertLogTable)
    .values({
      appId,
      metric,
      value: String(value),
      threshold: String(threshold),
      channels: channels.join(","),
    })
    .catch((err: unknown) => {
      logger.error({ err, appId, metric }, "infra-alert: failed to persist alert log row");
    });
}

// ---------------------------------------------------------------------------
// Budget overrun notification payload
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
// Infra pressure notification payload
// ---------------------------------------------------------------------------

interface InfraPressureAlert {
  app: AppRecord;
  metric: "cpu" | "memory";
  value: number;
  threshold: number;
  consecutiveChecks: number;
}

function metricLabel(metric: "cpu" | "memory"): string {
  return metric === "cpu" ? "CPU" : "Memory";
}

function metricUnit(_metric: "cpu" | "memory"): string {
  return "%";
}

// ---------------------------------------------------------------------------
// Teams (Adaptive Card via Incoming Webhook) — budget
// ---------------------------------------------------------------------------

async function sendTeamsBudgetAlert(
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
// Teams (Adaptive Card via Incoming Webhook) — infra pressure
// ---------------------------------------------------------------------------

async function sendTeamsInfraAlert(
  webhookUrl: string,
  alert: InfraPressureAlert,
): Promise<void> {
  const { app, metric, value, threshold, consecutiveChecks } = alert;
  const label = metricLabel(metric);
  const unit = metricUnit(metric);

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
              text: `⚠️ Infra Pressure — ${label} High on ${app.name}`,
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: `**${app.name}** (${app.environment}) has sustained high ${label.toLowerCase()} usage for ${consecutiveChecks} consecutive check${consecutiveChecks === 1 ? "" : "s"}.`,
              wrap: true,
              spacing: "Small",
            },
            {
              type: "FactSet",
              spacing: "Medium",
              facts: [
                { title: `Current ${label}`, value: `${value.toFixed(1)}${unit}` },
                { title: "Threshold", value: `${threshold.toFixed(1)}${unit}` },
                { title: "Consecutive checks over threshold", value: String(consecutiveChecks) },
                { title: "Resource group", value: app.resourceGroup },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View telemetry in Orbit",
              url: `https://orbit.kinisislabs.com/apps/${app.id}/telemetry`,
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

async function sendEmailBudgetAlert(
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
<p style="color:#888;font-size:12px;">This alert fires when forecast &gt; budget. It will not repeat for ${Math.round(cooldownMs(app.id) / 3_600_000)} hours.</p>
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

async function sendEmailInfraAlert(
  recipients: string[],
  alert: InfraPressureAlert,
): Promise<void> {
  if (recipients.length === 0) return;

  const { app, metric, value, threshold, consecutiveChecks } = alert;
  const label = metricLabel(metric);
  const unit = metricUnit(metric);
  const from = process.env["ALERT_SMTP_FROM"] ?? "orbit@kinisislabs.com";
  const subject = `[Orbit] Infra pressure — ${label} high on ${app.name} (${value.toFixed(1)}${unit})`;

  const html = `
<p>Hi team,</p>
<p><strong>${app.name}</strong> (${app.environment}) has sustained high ${label.toLowerCase()} usage for ${consecutiveChecks} consecutive check${consecutiveChecks === 1 ? "" : "s"}.</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
  <tr><td style="font-weight:bold;padding-right:24px;">Current ${label}</td><td>${value.toFixed(1)}${unit}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Threshold</td><td>${threshold.toFixed(1)}${unit}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Consecutive checks over threshold</td><td>${consecutiveChecks}</td></tr>
  <tr><td style="font-weight:bold;padding-right:24px;">Resource group</td><td>${app.resourceGroup}</td></tr>
</table>
<br>
<p><a href="https://orbit.kinisislabs.com/apps/${app.id}/telemetry">View telemetry in Orbit →</a></p>
<p style="color:#888;font-size:12px;">This alert fires when ${label} stays above ${threshold.toFixed(1)}${unit} for ${infraConsecutiveChecksRequired(app.id)} consecutive check${infraConsecutiveChecksRequired(app.id) === 1 ? "" : "s"}. It will not repeat for ${Math.round(cooldownMs(app.id) / 3_600_000)} hours.</p>
`;

  const text =
    `[Orbit] Infra pressure — ${label} high on ${app.name}\n\n` +
    `Current ${label}                 : ${value.toFixed(1)}${unit}\n` +
    `Threshold                        : ${threshold.toFixed(1)}${unit}\n` +
    `Consecutive checks over threshold: ${consecutiveChecks}\n` +
    `Resource group                   : ${app.resourceGroup}\n\n` +
    `View in Orbit: https://orbit.kinisislabs.com/apps/${app.id}/telemetry\n`;

  await getSmtpTransport().sendMail({ from, to: recipients.join(", "), subject, html, text });
}

// ---------------------------------------------------------------------------
// Core budget check logic
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

  const budget = budgetWithSource?.result.amount ?? Number((mtd * 2.0).toFixed(2));
  const forecastMultiplier = !budgetWithSource && app.id === "orbit" ? 2.3 : 1.7;
  const forecast =
    budgetWithSource?.result.forecastAmount ?? Number((mtd * forecastMultiplier).toFixed(2));

  return { mtd, forecast, budget };
}

/**
 * Run a single pass over all tracked apps checking budget forecasts.
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

    if (isBudgetOnCooldown(app.id)) {
      logger.debug({ appId: app.id }, "budget-alert: on cooldown, skipping notifications");
      continue;
    }

    const firedChannels: string[] = [];

    const teamsUrl = teamsWebhookUrl(app.id);
    if (teamsUrl) {
      try {
        await sendTeamsBudgetAlert(teamsUrl, alert);
        logger.info({ appId: app.id }, "budget-alert: Teams notification sent");
        alertsSent++;
        firedChannels.push("teams");
      } catch (err) {
        logger.error({ err, appId: app.id }, "budget-alert: Teams notification failed");
        errors++;
      }
    }

    const recipients = emailRecipients(app.id);
    if (isSmtpConfigured() && recipients.length > 0) {
      try {
        await sendEmailBudgetAlert(recipients, alert);
        logger.info({ appId: app.id, recipients }, "budget-alert: email notification sent");
        alertsSent++;
        firedChannels.push("email");
      } catch (err) {
        logger.error({ err, appId: app.id }, "budget-alert: email notification failed");
        errors++;
      }
    }

    if (firedChannels.length > 0) markBudgetAlertSent(app.id, alert, firedChannels);
  }

  return { checked: APPS.length, overruns, alertsSent, errors };
}

// ---------------------------------------------------------------------------
// Infra pressure check logic
// ---------------------------------------------------------------------------

/**
 * Resolve the last observed value for a single metric (cpu_pct or memory_pct)
 * for the given app using Azure Monitor Log Analytics.
 *
 * Fetches a 2-hour window (two hourly buckets) and returns the most recent
 * point's value, or null when Monitor is not configured / the query fails.
 */
async function resolveLastMetricValue(
  app: AppRecord,
  metricName: "cpu_pct" | "memory_pct",
): Promise<number | null> {
  try {
    const series = await fetchAppTimeSeries(app, metricName, 2, {});
    if (!series || series.length === 0) return null;
    const last = series[series.length - 1];
    return last ? last.value : null;
  } catch {
    return null;
  }
}

/**
 * Run a single pass over all tracked apps checking CPU and memory thresholds.
 *
 * Uses a consecutive-check counter per (app, metric) pair. An alert fires only
 * when the metric has been above the threshold for ALERT_INFRA_CONSECUTIVE_CHECKS
 * consecutive scheduler runs (default: 2). The counter resets to 0 as soon as
 * the metric drops back to or below the threshold.
 *
 * Returns a summary of what was found and what was sent.
 */
export async function checkInfraThresholds(): Promise<{
  checked: number;
  breaches: number;
  alertsSent: number;
  errors: number;
}> {
  let breaches = 0;
  let alertsSent = 0;
  let errors = 0;

  type MetricSpec = {
    name: "cpu_pct" | "memory_pct";
    kind: "cpu" | "memory";
    threshold: number;
  };

  for (const app of APPS) {
    const requiredConsecutive = infraConsecutiveChecksRequired(app.id);

    const metrics: MetricSpec[] = [
      { name: "cpu_pct", kind: "cpu", threshold: cpuThresholdPct(app.id) },
      { name: "memory_pct", kind: "memory", threshold: memoryThresholdPct(app.id) },
    ];

    for (const { name, kind, threshold } of metrics) {
      const counterKey = `${app.id}:${kind}`;

      let value: number | null = null;
      try {
        value = await resolveLastMetricValue(app, name);
      } catch (err) {
        logger.warn({ err, appId: app.id, metric: kind }, "infra-alert: failed to fetch metric");
        errors++;
        continue;
      }

      if (value === null) {
        // Monitor not configured or no data — reset consecutive count and skip.
        _infraConsecutiveCounts.set(counterKey, 0);
        continue;
      }

      if (value <= threshold) {
        // Metric is healthy — reset consecutive counter.
        _infraConsecutiveCounts.set(counterKey, 0);
        continue;
      }

      // Metric is above threshold — increment consecutive counter.
      const prev = _infraConsecutiveCounts.get(counterKey) ?? 0;
      const consecutive = prev + 1;
      _infraConsecutiveCounts.set(counterKey, consecutive);

      logger.debug(
        { appId: app.id, metric: kind, value, threshold, consecutive, requiredConsecutive },
        "infra-alert: metric above threshold",
      );

      if (consecutive < requiredConsecutive) {
        // Not yet enough consecutive over-threshold checks — don't fire yet.
        continue;
      }

      breaches++;

      logger.info(
        { appId: app.id, metric: kind, value, threshold, consecutive },
        "infra-alert: threshold breached for required consecutive checks",
      );

      if (isInfraOnCooldown(app.id, kind)) {
        logger.debug({ appId: app.id, metric: kind }, "infra-alert: on cooldown, skipping notifications");
        continue;
      }

      const infraAlert: InfraPressureAlert = {
        app,
        metric: kind,
        value,
        threshold,
        consecutiveChecks: consecutive,
      };

      const firedChannels: string[] = [];

      // --- Teams ---
      const teamsUrl = teamsWebhookUrl(app.id);
      if (teamsUrl) {
        try {
          await sendTeamsInfraAlert(teamsUrl, infraAlert);
          logger.info({ appId: app.id, metric: kind }, "infra-alert: Teams notification sent");
          alertsSent++;
          firedChannels.push("teams");
        } catch (err) {
          logger.error({ err, appId: app.id, metric: kind }, "infra-alert: Teams notification failed");
          errors++;
        }
      }

      // --- Email ---
      const recipients = emailRecipients(app.id);
      if (isSmtpConfigured() && recipients.length > 0) {
        try {
          await sendEmailInfraAlert(recipients, infraAlert);
          logger.info({ appId: app.id, metric: kind, recipients }, "infra-alert: email notification sent");
          alertsSent++;
          firedChannels.push("email");
        } catch (err) {
          logger.error({ err, appId: app.id, metric: kind }, "infra-alert: email notification failed");
          errors++;
        }
      }

      if (firedChannels.length > 0) {
        markInfraAlertSent(app.id, kind, value, threshold, firedChannels);
      }
    }
  }

  return { checked: APPS.length, breaches, alertsSent, errors };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let _schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background alert scheduler.
 *
 * Each run checks both budget forecasts and infra thresholds (CPU + memory).
 * No-op if no notification channel is configured, or if already running.
 * Safe to call at server startup.
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
    {
      intervalMinutes: intervalMs / 60_000,
      cooldownHours: cooldownMs() / 3_600_000,
      cpuThresholdPctDefault: cpuThresholdPct(),
      memoryThresholdPctDefault: memoryThresholdPct(),
      infraConsecutiveChecks: infraConsecutiveChecksRequired(),
    },
    "budget-alert: scheduler started (budget + infra checks; per-app threshold overrides apply at check time)",
  );

  const run = async (): Promise<void> => {
    try {
      const [budgetResult, infraResult] = await Promise.all([
        checkBudgetForecasts(),
        checkInfraThresholds(),
      ]);
      logger.info({ budget: budgetResult, infra: infraResult }, "budget-alert: check complete");
    } catch (err) {
      logger.error({ err }, "budget-alert: unexpected error during check");
    }
  };

  void run();
  _schedulerHandle = setInterval(() => void run(), intervalMs);
  _schedulerHandle.unref();
}

/** Stop the scheduler (primarily for tests). */
export function stopBudgetAlertScheduler(): void {
  if (_schedulerHandle !== null) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
  }
}
