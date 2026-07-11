import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";

const router: IRouter = Router();

// ── GrailBabe internal API proxy ──────────────────────────────────────────────
// Orbit's API holds GRAILBABE_INTERNAL_API_TOKEN and GRAILBABE_API_URL.
// UI callers never see the token.

function grailbabeUrl(): string {
  return (process.env.GRAILBABE_API_URL ?? "https://api.grailbabe.com").replace(/\/$/, "");
}

function internalToken(): string | null {
  return process.env.GRAILBABE_INTERNAL_API_TOKEN ?? null;
}

async function proxyToGrailBabe(
  method: "GET" | "POST" | "DELETE",
  path: string,
): Promise<{ status: number; body: unknown }> {
  const token = internalToken();
  if (!token) {
    return { status: 503, body: { error: "GRAILBABE_INTERNAL_API_TOKEN is not configured on this Orbit server.", debug_url: grailbabeUrl() } };
  }

  const url = `${grailbabeUrl()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = { error: "invalid_response" };
  }

  if (res.status !== 200) {
    return { status: res.status, body: { ...((body as object) ?? {}), debug_url: url, debug_status: res.status, debug_token_set: !!token } };
  }

  return { status: res.status, body };
}

// ── GET /api/crm/testers — list all GrailBabe tester accounts ─────────────────
router.get("/crm/testers", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, body } = await proxyToGrailBabe("GET", "/api/internal/v1/testers");
    res.status(status).json(body);
  } catch (err) {
    req.log.error({ err }, "GET /api/crm/testers failed");
    res.status(502).json({ error: "Failed to reach GrailBabe API" });
  }
});

// ── POST /api/crm/testers/:userId — provision a tester account ─────────────────
router.post("/crm/testers/:userId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "").trim();
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  try {
    const { status, body } = await proxyToGrailBabe("POST", `/api/internal/v1/testers/${userId}/provision`);
    res.status(status).json(body);
  } catch (err) {
    req.log.error({ err, userId }, "POST /api/crm/testers/:userId failed");
    res.status(502).json({ error: "Failed to reach GrailBabe API" });
  }
});

// ── DELETE /api/crm/testers/:userId — revoke a tester account ─────────────────
router.delete("/crm/testers/:userId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.userId ?? "").trim();
  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  try {
    const { status, body } = await proxyToGrailBabe("DELETE", `/api/internal/v1/testers/${userId}/provision`);
    res.status(status).json(body);
  } catch (err) {
    req.log.error({ err, userId }, "DELETE /api/crm/testers/:userId failed");
    res.status(502).json({ error: "Failed to reach GrailBabe API" });
  }
});

export default router;
