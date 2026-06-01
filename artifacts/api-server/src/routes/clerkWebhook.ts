import express, { Router, type IRouter } from "express";
import { Webhook } from "svix";
import { clerkSecretFor, recordEvent, type ClerkEvent } from "../lib/clerkActivity";
import { findApp } from "./orbit";

// Clerk webhook ingestion, one URL per Clerk instance:
//   POST /api/webhooks/clerk/:appId
// Mounted (in app.ts) BEFORE express.json() so the raw request bytes survive
// for Svix signature verification. No session/auth — secured by the signature.
const router: IRouter = Router();

router.post(
  "/:appId",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const appId = req.params.appId;
    const app = findApp(appId);
    if (!app || app.userAuth !== "clerk") {
      res.status(404).json({ error: "unknown clerk app" });
      return;
    }

    const secret = clerkSecretFor(appId);
    if (!secret) {
      req.log.warn({ appId }, "clerk webhook received but no signing secret configured");
      res.status(503).json({ error: "clerk webhook not configured for app" });
      return;
    }

    const payload = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : "";
    const headers = {
      "svix-id": req.header("svix-id") ?? "",
      "svix-timestamp": req.header("svix-timestamp") ?? "",
      "svix-signature": req.header("svix-signature") ?? "",
    };

    let evt: ClerkEvent;
    try {
      evt = new Webhook(secret).verify(payload, headers) as ClerkEvent;
    } catch (err) {
      req.log.warn(
        { appId, err: (err as Error).message },
        "clerk webhook signature verification failed",
      );
      res.status(400).json({ error: "invalid signature" });
      return;
    }

    try {
      await recordEvent(appId, headers["svix-id"], evt);
    } catch (err) {
      req.log.error({ appId, err }, "failed to record clerk event");
      res.status(500).json({ error: "ingest failed" });
      return;
    }

    res.status(202).json({ ok: true });
  },
);

export default router;
