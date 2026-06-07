import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ error: "unauthorized" });
};

export const requireCostReader: RequestHandler = (req, res, next) => {
  if (req.session.user?.isCostReader || req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.session.user?.isAdmin) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Admins" });
};

export const requireEngineerOrAdmin: RequestHandler = (req, res, next) => {
  if (req.session.user?.isAdmin || req.session.user?.isEngineer) return next();
  res.status(403).json({ error: "forbidden", requiredGroup: "Orbit-Admins or Orbit-Engineers" });
};
