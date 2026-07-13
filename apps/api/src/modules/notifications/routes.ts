import { Router } from "express";
import { eq, and, or, isNull, sql, desc } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { notificationsTable, type NotificationType } from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";

const router = Router();

// ── GET /api/notifications — current user's notifications (+ broadcasts) ─────
router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user!.id;
    const now = new Date();

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          or(eq(notificationsTable.userId, userId), isNull(notificationsTable.userId)),
          or(isNull(notificationsTable.expiresAt), sql`${notificationsTable.expiresAt} > ${now}`),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/notifications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /api/notifications/unread-count ───────────────────────────────────────
router.get("/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user!.id;
    const now = new Date();

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.read, false),
          or(eq(notificationsTable.userId, userId), isNull(notificationsTable.userId)),
          or(isNull(notificationsTable.expiresAt), sql`${notificationsTable.expiresAt} > ${now}`),
        ),
      );

    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    req.log.error(err, "GET /api/notifications/unread-count failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /api/notifications/:id/read — mark one as read ──────────────────────
router.post("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user!.id;
    const id = String(req.params.id);

    await db
      .update(notificationsTable)
      .set({ read: true, readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          or(eq(notificationsTable.userId, userId), isNull(notificationsTable.userId)),
        ),
      );

    res.status(204).end();
  } catch (err) {
    req.log.error(err, "POST /api/notifications/:id/read failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /api/notifications/read-all — mark all as read ──────────────────────
router.post("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user!.id;

    await db
      .update(notificationsTable)
      .set({ read: true, readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.read, false),
          or(eq(notificationsTable.userId, userId), isNull(notificationsTable.userId)),
        ),
      );

    res.status(204).end();
  } catch (err) {
    req.log.error(err, "POST /api/notifications/read-all failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/admin/notifications — list all notifications
router.get("/admin/notifications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(notificationsTable)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/admin/notifications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/admin/notifications — create/broadcast a notification
router.post("/admin/notifications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      title: string;
      body: string;
      type?: NotificationType;
      userId?: string;
      actionUrl?: string;
      expiresAt?: string;
    };

    if (!body.title || !body.body) {
      res.status(400).json({ message: "title and body are required" });
      return;
    }

    const [created] = await db
      .insert(notificationsTable)
      .values({
        userId: body.userId ?? null,
        title: body.title,
        body: body.body,
        type: body.type ?? "info",
        actionUrl: body.actionUrl ?? null,
        createdBy: req.session.user!.id,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error(err, "POST /api/admin/notifications failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/admin/notifications/:id — delete a notification
router.delete("/admin/notifications/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.id, String(req.params.id)));
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/admin/notifications/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
