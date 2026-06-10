import { Router, type IRouter } from "express";
import {
  GetLedgerResponse,
  IngestLedgerSaleBody,
  ListLedgerEntriesResponse,
  ListLedgerEntriesResponseItem,
  PostLedgerEntryBody,
  ReconcileLedgerResponse,
  SyncStripeSalesResponse,
  SyncAppStoreSalesResponse,
  SyncPlayStoreSalesResponse,
} from "@workspace/api-zod";
import { findApp } from "./orbit";
import {
  getLedgerReport,
  ingestSale,
  listEntries,
  postEntry,
  runReconciliation,
  LedgerError,
} from "../lib/ledger";
import { isStripeConfigured } from "../lib/stripeClient";
import { syncStripeSales } from "../lib/stripeSync";
import {
  isAppleReportConfigured,
  ingestAppleReport,
} from "../lib/appleReports";
import {
  isPlayReportConfigured,
  ingestPlayReport,
} from "../lib/playReports";

// Live Stripe import is intentionally scoped to GrailBabe only.
const STRIPE_SYNC_WORKLOAD = "grailbabe";

const router: IRouter = Router();

// Financial ledger report (balances, reconciliation, recent transactions).
router.get("/apps/:appId/ledger", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const report = await getLedgerReport(app.id);
  res.json(GetLedgerResponse.parse(report));
});

// Full journal entry history for an app, newest first (capped for safety).
router.get("/apps/:appId/ledger/entries", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const entries = await listEntries(app.id);
  res.json(ListLedgerEntriesResponse.parse(entries));
});

// Post a new balanced double-entry journal entry. This is the write seam that
// a Stripe (or other) ingestion job would call.
router.post("/apps/:appId/ledger/entries", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const parsed = PostLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid entry", details: parsed.error.issues });
    return;
  }
  try {
    const entry = await postEntry(app.id, {
      ...parsed.data,
      postedAt: parsed.data.postedAt ? new Date(parsed.data.postedAt) : undefined,
    });
    res.status(201).json(ListLedgerEntriesResponseItem.parse(entry));
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "failed to post ledger entry");
    res.status(500).json({ error: "Internal error" });
  }
});

// Ingest a platform sale, splitting it into a gross-revenue capture and a
// platform-fee expense so net cash is correct. This is the generic seam the live
// Stripe / Apple App Store / Google Play feeds will call.
router.post("/apps/:appId/ledger/sales", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const parsed = IngestLedgerSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sale", details: parsed.error.issues });
    return;
  }
  try {
    const result = await ingestSale(app.id, {
      ...parsed.data,
      postedAt: parsed.data.postedAt ? new Date(parsed.data.postedAt) : undefined,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "failed to ingest ledger sale");
    res.status(500).json({ error: "Internal error" });
  }
});

// Import live Stripe charges into the ledger, booking each sale's actual Stripe
// fee as the platform-fee expense. Scoped to GrailBabe only.
router.post("/apps/:appId/ledger/stripe/sync", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  if (app.id !== STRIPE_SYNC_WORKLOAD) {
    res
      .status(400)
      .json({ error: "Live Stripe sync is only enabled for GrailBabe" });
    return;
  }
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Stripe is not connected" });
    return;
  }
  try {
    const result = await syncStripeSales(app.id);
    res.json(SyncStripeSalesResponse.parse(result));
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "failed to sync stripe sales");
    res.status(500).json({ error: "Internal error" });
  }
});

// Default month: the previous calendar month in YYYY-MM format.
function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// Validate a YYYY-MM month string.
function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

// Import Apple App Store SUBSCRIPTION_EVENT monthly report into the ledger.
// Each renewal / new subscription is recorded as a balanced sale entry.
// Idempotent: re-running the same month re-uses the externalRef uniqueness
// constraint rather than creating duplicate entries.
router.post("/apps/:appId/ledger/app-store/sync", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  if (!isAppleReportConfigured()) {
    res.status(503).json({
      error:
        "Apple App Store report credentials not configured. " +
        "Set APPLE_CONNECT_ISSUER_ID, APPLE_CONNECT_KEY_ID, " +
        "APPLE_CONNECT_PRIVATE_KEY, and APPLE_VENDOR_NUMBER.",
    });
    return;
  }
  const month = (req.query.month as string | undefined) ?? defaultMonth();
  if (!isValidMonth(month)) {
    res.status(400).json({ error: "Invalid month; expected YYYY-MM" });
    return;
  }
  try {
    const result = await ingestAppleReport(app.id, month);
    res.json(SyncAppStoreSalesResponse.parse(result));
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "failed to sync Apple App Store report");
    res.status(500).json({ error: "Internal error" });
  }
});

// Import Google Play earnings report from the configured GCS bucket into the
// ledger. Gross is reconstructed from net proceeds (÷ 0.85) so the Play fee
// is correctly booked as an expense. Idempotent on the Play order number.
router.post("/apps/:appId/ledger/play-store/sync", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  if (!isPlayReportConfigured()) {
    res.status(503).json({
      error:
        "Google Play report credentials not configured. " +
        "Set GOOGLE_PLAY_SA_EMAIL, GOOGLE_PLAY_WIF_AUDIENCE, " +
        "GOOGLE_PLAY_DEVELOPER_ID, and GOOGLE_PLAY_REPORTING_BUCKET.",
    });
    return;
  }
  const month = (req.query.month as string | undefined) ?? defaultMonth();
  if (!isValidMonth(month)) {
    res.status(400).json({ error: "Invalid month; expected YYYY-MM" });
    return;
  }
  try {
    const result = await ingestPlayReport(app.id, month);
    res.json(SyncPlayStoreSalesResponse.parse(result));
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "failed to sync Google Play earnings report");
    res.status(500).json({ error: "Internal error" });
  }
});

// Run reconciliation and persist the result as a reconciliation run.
router.post("/apps/:appId/ledger/reconcile", async (req, res) => {
  const app = findApp(req.params.appId);
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const result = await runReconciliation(app.id);
  res.json(ReconcileLedgerResponse.parse(result));
});

export default router;
