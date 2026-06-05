import type { RequestHandler } from "express";
import { isEntraConfigured } from "../lib/entra";

/**
 * Require an authenticated session. In mock mode (no Entra config) the gate is
 * open so the Replit dev preview works without sign-in.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user) return next();
  res.status(401).json({ error: "unauthorized" });
};

/** Require membership in the Orbit-Cost-Readers group for FinOps surfaces.
 * Orbit-Admins implicitly satisfy this requirement. */
export const requireCostReader: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user?.isCostReader || req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
};

/** Require membership in the Orbit-Admins group for write/configuration surfaces.
 * In mock mode (no Entra config) the gate is open so the dev preview keeps working. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Admins" });
};
