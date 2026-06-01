import { Router, type IRouter } from "express";
import {
  GetLedgerResponse,
  IngestLedgerSaleBody,
  ListLedgerEntriesResponse,
  ListLedgerEntriesResponseItem,
  PostLedgerEntryBody,
  ReconcileLedgerResponse,
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
    const entry = await postEntry(app.id, parsed.data);
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
    const result = await ingestSale(app.id, parsed.data);
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
