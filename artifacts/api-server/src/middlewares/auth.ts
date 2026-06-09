import type { RequestHandler } from "express";
import { isEntraConfigured } from "../lib/entra.js";
import type { SessionUser } from "../lib/session.js";

/**
 * Synthetic session user injected in mock/dev mode (no Entra configured).
 * Has all privilege flags set so every route behaves as if signed in by a
 * fully-privileged developer — cost surfaces, admin actions, etc. are all
 * reachable without a real Entra session.
 */
const DEV_SESSION_USER: SessionUser = {
  id: "dev-mock-user",
  displayName: "Dev User",
  userPrincipalName: "dev@kinisislabs.com",
  jobTitle: "Developer",
  groupIds: [],
  isCostReader: true,
  isAdmin: true,
  isEngineer: true,
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) {
    // Populate a synthetic dev user so route handlers that read
    // req.session.user (e.g. acknowledged-by attribution) work correctly
    // without a real Entra session or a provisioned session-store table.
    if (req.session && !req.session.user) {
      req.session.user = DEV_SESSION_USER;
    }
    return next();
  }
  if (req.session.user) return next();
  res.status(401).json({ error: "unauthorized" });
};

export const requireCostReader: RequestHandler = (req, res, next) => {
  if (!isEntraConfigured()) return next();
  if (req.session.user?.isCostReader || req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
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
