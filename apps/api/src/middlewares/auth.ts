import type { RequestHandler } from "express";
import { isEntraConfigured } from "../lib/entra.js";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user) return next();
  res.status(401).json({ error: "unauthorized" });
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Admins" });
};

export const requireEngineerOrAdmin: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user?.isAdmin || req.session.user?.isEngineer) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Admins or Orbit-Engineers" });
};

/**
 * Returns a middleware that checks whether the authenticated user holds a
 * named feature permission (stored in their session after RBAC evaluation).
 * Falls back to pass-through in mock/dev mode (Entra not configured).
 */
export function requirePermission(permission: string): RequestHandler {
  return (req, res, next) => {
    if (!isEntraConfigured()) return next();
    if (!req.session.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const perms: string[] = (req.session.user as unknown as { permissions?: string[] }).permissions ?? [];
    if (req.session.user.isAdmin || perms.includes(permission)) return next();
    res.status(403).json({ error: "forbidden", requiredPermission: permission });
  };
}
