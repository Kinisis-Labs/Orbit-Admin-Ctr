import type { Response } from "express";
import { logger } from "./logger.js";

const _sseClients = new Set<Response>();

export function addSseClient(res: Response): void {
  _sseClients.add(res);
  logger.debug({ total: _sseClients.size }, "alert-sse: client connected");
}

export function removeSseClient(res: Response): void {
  _sseClients.delete(res);
  logger.debug({ total: _sseClients.size }, "alert-sse: client disconnected");
}

/**
 * Broadcast an SSE "alert" event to every connected client.
 * Clients use this signal to invalidate their alert-log React Query cache,
 * causing an immediate refetch without waiting for the 60-second poll interval.
 */
export function broadcastAlertEvent(eventType: "budget" | "infra"): void {
  if (_sseClients.size === 0) return;
  const data = `event: alert\ndata: ${JSON.stringify({ type: eventType })}\n\n`;
  for (const res of _sseClients) {
    try {
      res.write(data);
    } catch (err) {
      logger.warn({ err }, "alert-sse: write failed, removing stale client");
      _sseClients.delete(res);
    }
  }
  logger.debug({ clients: _sseClients.size, eventType }, "alert-sse: broadcast sent");
}
