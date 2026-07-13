/**
 * NOC Alert Dispatch — SMS via Twilio, Email via SMTP/SendGrid.
 *
 * Required env vars:
 *   SMS:   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *   Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *          (or SENDGRID_API_KEY + SMTP_FROM for SendGrid)
 */

import { logger } from "./logger.js";
import { db } from "./db.js";
import { alertContactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertPayload {
  title: string;
  body: string;
  severity: AlertSeverity;
  resourceName?: string;
  url?: string;
}

// ── SMS via Twilio ─────────────────────────────────────────────────────────────

function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

async function sendSms(to: string, message: string): Promise<boolean> {
  if (!isTwilioConfigured()) {
    logger.warn("Twilio not configured — skipping SMS");
    return false;
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_FROM_NUMBER!;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: from, Body: message });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: txt.slice(0, 200) }, "Twilio SMS failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Twilio SMS threw");
    return false;
  }
}

// ── Email via SMTP ─────────────────────────────────────────────────────────────

function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!isSmtpConfigured()) {
    logger.warn("SMTP not configured — skipping email");
    return false;
  }
  try {
    const { createTransport } = await import("nodemailer");
    const transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    logger.warn({ err }, "SMTP email threw");
    return false;
  }
}

// ── Severity helpers ───────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<AlertSeverity, string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

function wantsAlert(severities: string[], actual: AlertSeverity): boolean {
  return severities.includes(actual);
}

function buildSmsMessage(alert: AlertPayload): string {
  const emoji = SEVERITY_EMOJI[alert.severity];
  const parts = [`${emoji} ORBIT NOC ALERT`, `${alert.title}`];
  if (alert.resourceName) parts.push(`Resource: ${alert.resourceName}`);
  parts.push(alert.body.slice(0, 120));
  if (alert.url) parts.push(alert.url);
  return parts.join("\n");
}

function buildEmailHtml(alert: AlertPayload): string {
  const color = alert.severity === "critical" ? "#ef4444" : alert.severity === "warning" ? "#f59e0b" : "#3b82f6";
  const emoji = SEVERITY_EMOJI[alert.severity];
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d1117;color:#e6edf3;border-radius:12px;overflow:hidden">
      <div style="background:${color};padding:16px 24px">
        <h1 style="margin:0;font-size:18px;color:#fff">${emoji} ORBIT NOC Alert — ${alert.severity.toUpperCase()}</h1>
      </div>
      <div style="padding:24px">
        <h2 style="margin:0 0 8px;font-size:16px;color:#e6edf3">${alert.title}</h2>
        ${alert.resourceName ? `<p style="margin:0 0 12px;font-size:13px;color:#8b949e">Resource: <strong style="color:#e6edf3">${alert.resourceName}</strong></p>` : ""}
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#c9d1d9">${alert.body}</p>
        ${alert.url ? `<a href="${alert.url}" style="display:inline-block;background:${color};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">View in Orbit</a>` : ""}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #21262d;font-size:11px;color:#484f58">
        Sent by Orbit NOC Alert System · ${new Date().toUTCString()}
      </div>
    </div>
  `;
}

// ── Main dispatch function ─────────────────────────────────────────────────────

export async function dispatchNocAlert(alert: AlertPayload): Promise<{ sms: number; email: number }> {
  let smsCount = 0;
  let emailCount = 0;

  try {
    const contacts = await db.select().from(alertContactsTable);
    const eligible = contacts.filter((c) => wantsAlert(c.severities, alert.severity));

    await Promise.allSettled(
      eligible.map(async (contact) => {
        if (contact.smsEnabled && contact.phone) {
          const ok = await sendSms(contact.phone, buildSmsMessage(alert));
          if (ok) smsCount++;
        }
        if (contact.emailEnabled && contact.email) {
          const subject = `[ORBIT NOC] ${alert.severity.toUpperCase()}: ${alert.title}`;
          const ok = await sendEmail(contact.email, subject, buildEmailHtml(alert));
          if (ok) emailCount++;
        }
      }),
    );
  } catch (err) {
    logger.error({ err }, "dispatchNocAlert failed");
  }

  logger.info({ severity: alert.severity, title: alert.title, smsCount, emailCount }, "NOC alert dispatched");
  return { sms: smsCount, email: emailCount };
}

export async function dispatchTestAlert(contactId: string): Promise<{ sms: boolean; email: boolean }> {
  const [contact] = await db
    .select()
    .from(alertContactsTable)
    .where(eq(alertContactsTable.id, contactId))
    .limit(1);

  if (!contact) throw new Error("Contact not found");

  const alert: AlertPayload = {
    title: "Test Alert from Orbit NOC",
    body: "This is a test notification from the Orbit NOC alert system. If you received this, your contact is configured correctly.",
    severity: "info",
    url: process.env.ENTRA_REDIRECT_URI?.replace("/auth/callback", "") ?? undefined,
  };

  const smsSent = contact.smsEnabled && contact.phone
    ? await sendSms(contact.phone, buildSmsMessage(alert))
    : false;

  const emailSent = contact.emailEnabled && contact.email
    ? await sendEmail(contact.email, `[ORBIT NOC] Test Alert`, buildEmailHtml(alert))
    : false;

  return { sms: smsSent, email: emailSent };
}
