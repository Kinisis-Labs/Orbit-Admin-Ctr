import { Router, type IRouter } from "express";
import { addSseClient, removeSseClient } from "../lib/alertSse.js";

const router: IRouter = Router();

/**
 * GET /api/alerts/stream
 *
 * Server-sent events stream. Emits an "alert" event whenever a new budget or
 * infra alert log entry is written to the database. The frontend subscribes
 * and immediately invalidates its React Query alert-log cache, so the badge
 * count updates without waiting for the next 60-second poll.
 *
 * Falls back gracefully: if SSE is unsupported or the connection drops,
 * the 60-second polling interval in useUnacknowledgedBudgetAlerts continues
 * to work as before.
 *
 * Gated by requireAuth (applied in index.ts) — the stream carries no alert
 * data, only a signal to re-fetch.
 */
router.get("/alerts/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Prevent nginx / Azure Front Door from buffering the stream.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Confirm the connection is open to the browser immediately.
  res.write(": connected\n\n");

  addSseClient(res);

  // Send a keepalive comment every 25 s to keep the connection alive through
  // proxies that close idle connections after 30 s.
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      // client gone — cleanup handles it
    }
  }, 25_000);

  const cleanup = () => {
    clearInterval(keepalive);
    removeSseClient(res);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;
