import { Router, type Request } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { resolveEffectivePermissions } from "../../services/effectivePermissions.js";
import { auditFromReq } from "../../lib/audit.js";
import { CorpusUpstreamError, normalizeUpstreamError, requestGrailBabeCorpus } from "./client.js";
import { sendCorpusProxyError } from "./errors.js";
import { validateCorpusProxyBody } from "./validation.js";
import { mapOrbitCorpusPermissions, type OrbitCorpusPermission } from "./permissions.js";

interface AllowedRoute {
  method: string;
  pattern: RegExp;
  required: OrbitCorpusPermission;
  mutation?: boolean;
}

const ROUTES: readonly AllowedRoute[] = [
  { method: "GET", pattern: /^\/overview$/, required: "grailscan.corpus.view" },
  { method: "GET", pattern: /^\/submissions$/, required: "grailscan.corpus.view" },
  {
    method: "POST",
    pattern: /^\/submissions$/,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  { method: "GET", pattern: /^\/submissions\/[0-9a-f-]{36}$/i, required: "grailscan.corpus.view" },
  {
    method: "POST",
    pattern: /^\/submissions\/[0-9a-f-]{36}\/groups$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/submissions\/[0-9a-f-]{36}\/complete$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  { method: "GET", pattern: /^\/groups\/[0-9a-f-]{36}$/i, required: "grailscan.corpus.view" },
  {
    method: "PATCH",
    pattern: /^\/groups\/[0-9a-f-]{36}$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/groups\/[0-9a-f-]{36}\/complete$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/groups\/[0-9a-f-]{36}\/images\/upload-authorizations$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  { method: "GET", pattern: /^\/images\/[0-9a-f-]{36}$/i, required: "grailscan.corpus.view" },
  {
    method: "DELETE",
    pattern: /^\/images\/[0-9a-f-]{36}$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/images\/[0-9a-f-]{36}\/complete$/i,
    required: "grailscan.corpus.upload",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/images\/[0-9a-f-]{36}\/reanalyze$/i,
    required: "grailscan.corpus.review",
    mutation: true,
  },
  {
    method: "GET",
    pattern: /^\/images\/[0-9a-f-]{36}\/preview$/i,
    required: "grailscan.corpus.view",
  },
  { method: "GET", pattern: /^\/review-queue$/, required: "grailscan.corpus.review" },
  { method: "GET", pattern: /^\/approved-pool$/, required: "grailscan.corpus.view" },
  {
    method: "POST",
    pattern: /^\/groups\/[0-9a-f-]{36}\/(claim|release)$/i,
    required: "grailscan.corpus.review",
    mutation: true,
  },
  {
    method: "PUT",
    pattern: /^\/groups\/[0-9a-f-]{36}\/rights$/i,
    required: "grailscan.corpus.manage_rights",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/groups\/[0-9a-f-]{36}\/(approve|correct-and-approve)$/i,
    required: "grailscan.corpus.approve",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/groups\/[0-9a-f-]{36}\/(reject|mark-duplicate|reopen|retire)$/i,
    required: "grailscan.corpus.review",
    mutation: true,
  },
  {
    method: "GET",
    pattern: /^\/groups\/[0-9a-f-]{36}\/review-history$/i,
    required: "grailscan.corpus.view",
  },
  { method: "GET", pattern: /^\/versions$/, required: "grailscan.corpus.view" },
  {
    method: "POST",
    pattern: /^\/versions$/,
    required: "grailscan.corpus.manage_versions",
    mutation: true,
  },
  {
    method: "GET",
    pattern: /^\/versions\/[0-9a-f-]{36}$/i,
    required: "grailscan.corpus.view",
  },
  {
    method: "POST",
    pattern: /^\/versions\/[0-9a-f-]{36}\/members$/i,
    required: "grailscan.corpus.manage_versions",
    mutation: true,
  },
  {
    method: "DELETE",
    pattern: /^\/versions\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}$/i,
    required: "grailscan.corpus.manage_versions",
    mutation: true,
  },
  {
    method: "POST",
    pattern: /^\/versions\/[0-9a-f-]{36}\/validate$/i,
    required: "grailscan.corpus.manage_versions",
  },
  {
    method: "POST",
    pattern: /^\/versions\/[0-9a-f-]{36}\/(freeze|activate)$/i,
    required: "grailscan.corpus.manage_versions",
    mutation: true,
  },
  { method: "GET", pattern: /^\/coverage$/, required: "grailscan.corpus.view" },
  { method: "GET", pattern: /^\/regression-runs$/, required: "grailscan.corpus.view" },
  {
    method: "POST",
    pattern: /^\/regression-runs$/,
    required: "grailscan.corpus.run_regression",
    mutation: true,
  },
  {
    method: "GET",
    pattern: /^\/regression-runs\/[0-9a-f-]{36}$/i,
    required: "grailscan.corpus.view",
  },
  {
    method: "GET",
    pattern: /^\/regression-runs\/[0-9a-f-]{36}\/(results|failures)$/i,
    required: "grailscan.corpus.view",
  },
  { method: "GET", pattern: /^\/health$/, required: "grailscan.corpus.view_health" },
  { method: "GET", pattern: /^\/storage$/, required: "grailscan.corpus.view_storage" },
  { method: "GET", pattern: /^\/audit$/, required: "grailscan.corpus.view_health" },
] as const;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

function rawQuery(req: Request): string {
  const separator = req.originalUrl.indexOf("?");
  return separator === -1 ? "" : req.originalUrl.slice(separator + 1);
}

const router = Router();
router.use(requireAuth);
router.use(async (req, res) => {
  const route = ROUTES.find(
    (candidate) =>
      candidate.method === req.method.toUpperCase() && candidate.pattern.test(req.path),
  );
  if (!route) {
    sendCorpusProxyError(res, 404, "grailscan_corpus_proxy_route_not_found", "Route not found");
    return;
  }
  const actor = req.session.user!;
  try {
    const effectivePermissions = await resolveEffectivePermissions(actor.id, actor.isAdmin);
    if (!actor.isAdmin && !effectivePermissions.includes(route.required)) {
      sendCorpusProxyError(res, 403, "grailscan_corpus_permission_denied", "Permission denied");
      return;
    }
    const permissions = mapOrbitCorpusPermissions(effectivePermissions);
    if (actor.isAdmin && permissions.length === 0) {
      permissions.push(...mapOrbitCorpusPermissions(["grailscan.corpus.admin"]));
    }
    const idempotencyKey = req.header("idempotency-key")?.trim();
    if (route.mutation && (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey))) {
      sendCorpusProxyError(
        res,
        400,
        "grailscan_corpus_idempotency_key_required",
        "A valid Idempotency-Key is required",
      );
      return;
    }
    const body = route.mutation
      ? validateCorpusProxyBody(req.method.toUpperCase(), req.path, req.body)
      : {};
    const response = await requestGrailBabeCorpus({
      method: req.method,
      path: req.path,
      rawQuery: rawQuery(req),
      body,
      actor,
      backendPermissions: permissions,
      idempotencyKey,
    });
    if (route.mutation) {
      void auditFromReq(req, {
        action: `grailscan.corpus.proxy.${req.method.toLowerCase()}`,
        category: "application",
        entityType: "grailscan_corpus",
        entityId: req.path,
        detail: { status: response.status },
      });
    }
    res.status(response.status).type(response.contentType).send(response.body);
  } catch (error) {
    if (error instanceof CorpusUpstreamError) {
      const normalized = normalizeUpstreamError(error);
      res.status(normalized.status).json(normalized.body);
      return;
    }
    if (error instanceof Error && error.message === "grailscan_corpus_invalid_request") {
      sendCorpusProxyError(res, 400, error.message, "Request validation failed");
      return;
    }
    req.log.error({ err: error }, "Golden Corpus proxy request failed");
    const code =
      error instanceof Error && error.message === "grailscan_corpus_upstream_timeout"
        ? error.message
        : "grailscan_corpus_upstream_unavailable";
    sendCorpusProxyError(
      res,
      code === "grailscan_corpus_upstream_timeout" ? 504 : 502,
      code,
      "Golden Corpus is temporarily unavailable",
    );
  }
});

export default router;
