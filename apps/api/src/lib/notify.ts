import { db } from "./db.js";
import { notificationsTable, type NotificationType } from "@workspace/db";

export interface NotifyOptions {
  /** Target user ID — omit for broadcast (all users) */
  userId?: string;
  title: string;
  body: string;
  type?: NotificationType;
  actionUrl?: string;
  createdBy?: string;
  expiresAt?: Date;
}

/** Fire-and-forget helper. Errors are swallowed so notifications never crash the caller. */
export async function createNotification(opts: NotifyOptions): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId: opts.userId ?? null,
      title: opts.title,
      body: opts.body,
      type: opts.type ?? "info",
      actionUrl: opts.actionUrl ?? null,
      createdBy: opts.createdBy ?? null,
      expiresAt: opts.expiresAt ?? null,
    });
  } catch (_err) {
    // Notification failures must never crash the API
  }
}
