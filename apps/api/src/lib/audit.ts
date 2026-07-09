import { db } from "./db.js";
import { auditLogTable, type AuditCategory, type AuditOutcome } from "@workspace/db";
import type { Request } from "express";
import type { SessionUser } from "./session.js";

export interface AuditEntry {
  action: string;
  category: AuditCategory;
  outcome?: AuditOutcome;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  detail?: Record<string, unknown>;
  actor?: Pick<SessionUser, "id" | "displayName" | "userPrincipalName">;
  req?: Request;
}

/** Fire-and-forget audit log write. Errors are swallowed so auditing never breaks the caller. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.displayName ?? null,
      actorUpn: entry.actor?.userPrincipalName ?? null,
      action: entry.action,
      category: entry.category,
      outcome: entry.outcome ?? "success",
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      entityName: entry.entityName ?? null,
      detail: entry.detail ?? null,
      ipAddress: entry.req
        ? (entry.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
          entry.req.socket.remoteAddress ??
          null
        : null,
      userAgent: entry.req ? (entry.req.headers["user-agent"] ?? null) : null,
    });
  } catch (_err) {
    // Audit failures must never crash the API
  }
}

/** Convenience wrapper that pulls actor from req.session.user */
export function auditFromReq(
  req: Request,
  entry: Omit<AuditEntry, "actor" | "req">,
): Promise<void> {
  return logAudit({ ...entry, actor: req.session.user ?? undefined, req });
}
