import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { alertContactsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import { dispatchNocAlert, dispatchTestAlert } from "../../lib/alert-dispatch.js";
import { auditFromReq } from "../../lib/audit.js";

const router = Router();

// GET /alert-contacts
router.get("/alert-contacts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(alertContactsTable).orderBy(alertContactsTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err, "GET /api/alert-contacts failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /alert-contacts
router.post("/alert-contacts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      name: string;
      email?: string;
      phone?: string;
      smsEnabled?: boolean;
      emailEnabled?: boolean;
      severities?: string[];
    };
    if (!body.name?.trim()) {
      res.status(400).json({ message: "name is required" });
      return;
    }
    if (!body.email && !body.phone) {
      res.status(400).json({ message: "at least one of email or phone is required" });
      return;
    }
    const [created] = await db
      .insert(alertContactsTable)
      .values({
        name: body.name.trim(),
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        smsEnabled: body.smsEnabled ?? false,
        emailEnabled: body.emailEnabled ?? false,
        severities: body.severities ?? ["warning", "critical"],
        createdBy: req.session.user!.id,
      })
      .returning();
    void auditFromReq(req, {
      action: "alert-contact.create",
      category: "configuration",
      entityType: "alert_contact",
      entityId: created.id,
      entityName: created.name,
    });
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err, "POST /api/alert-contacts failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /alert-contacts/:id
router.put("/alert-contacts/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body as Partial<{
      name: string;
      email: string;
      phone: string;
      smsEnabled: boolean;
      emailEnabled: boolean;
      severities: string[];
    }>;
    const [updated] = await db
      .update(alertContactsTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email || null }),
        ...(body.phone !== undefined && { phone: body.phone || null }),
        ...(body.smsEnabled !== undefined && { smsEnabled: body.smsEnabled }),
        ...(body.emailEnabled !== undefined && { emailEnabled: body.emailEnabled }),
        ...(body.severities !== undefined && { severities: body.severities }),
        updatedAt: new Date(),
      })
      .where(eq(alertContactsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "PUT /api/alert-contacts/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /alert-contacts/:id
router.delete("/alert-contacts/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await db.delete(alertContactsTable).where(eq(alertContactsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /api/alert-contacts/:id failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /alert-contacts/:id/test — send a test SMS + email
router.post("/alert-contacts/:id/test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const result = await dispatchTestAlert(id);
    res.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.error(err, "POST /api/alert-contacts/:id/test failed");
    res.status(400).json({ message: msg });
  }
});

// POST /alert-contacts/dispatch — manually dispatch an alert
router.post("/alert-contacts/dispatch", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      title: string;
      body: string;
      severity?: "info" | "warning" | "critical";
      resourceName?: string;
    };
    if (!body.title || !body.body) {
      res.status(400).json({ message: "title and body are required" });
      return;
    }
    const result = await dispatchNocAlert({
      title: body.title,
      body: body.body,
      severity: body.severity ?? "warning",
      resourceName: body.resourceName,
    });
    void auditFromReq(req, {
      action: "alert.dispatch.manual",
      category: "configuration",
      entityType: "alert",
      entityName: body.title,
      detail: result,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    req.log.error(err, "POST /api/alert-contacts/dispatch failed");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
