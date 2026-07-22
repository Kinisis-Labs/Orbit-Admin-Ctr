import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { resolveEffectivePermissions } from "../../services/effectivePermissions.js";
import {
  requestGrailBabeCorpus,
  CorpusUpstreamError,
  normalizeUpstreamError,
} from "../grailscan-corpus/client.js";
import { mapOrbitCorpusPermissions } from "../grailscan-corpus/permissions.js";
import { sendCorpusProxyError } from "../grailscan-corpus/errors.js";

const UUID = "[0-9a-f-]{36}";
const routes = [
  {
    method: "GET",
    pattern: /^\/datasets$/,
    permission: "grailscan.corpus.reference.view",
    mutation: false,
  },
  {
    method: "GET",
    pattern: new RegExp(`^/datasets/[a-z0-9-]{1,100}$`),
    permission: "grailscan.corpus.reference.view",
    mutation: false,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/datasets/[a-z0-9-]{1,100}/runs$`),
    permission: "grailscan.corpus.reference.manage",
    mutation: true,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/runs/${UUID}/commands$`, "i"),
    permission: "grailscan.corpus.reference.manage",
    mutation: true,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/revisions/${UUID}/publish$`, "i"),
    permission: "grailscan.corpus.reference.publish",
    mutation: true,
  },
] as const;

const router = Router();
router.use(requireAuth);
router.use(async (req, res) => {
  const route = routes.find(
    (candidate) => candidate.method === req.method && candidate.pattern.test(req.path),
  );
  if (!route)
    return sendCorpusProxyError(
      res,
      404,
      "reference_dataset_proxy_route_not_found",
      "Route not found",
    );
  const actor = req.session.user!;
  const effective = await resolveEffectivePermissions(actor.id, actor.isAdmin);
  if (!actor.isAdmin && !effective.includes(route.permission)) {
    return sendCorpusProxyError(
      res,
      403,
      "reference_dataset_permission_denied",
      "Permission denied",
    );
  }
  const idempotencyKey = req.header("idempotency-key")?.trim();
  if (
    route.mutation &&
    (!idempotencyKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey))
  ) {
    return sendCorpusProxyError(
      res,
      400,
      "reference_dataset_idempotency_key_required",
      "A valid Idempotency-Key is required",
    );
  }
  try {
    const response = await requestGrailBabeCorpus({
      method: req.method,
      path: req.path,
      rawQuery: req.originalUrl.split("?")[1] ?? "",
      body: route.mutation ? req.body : {},
      actor,
      backendPermissions: mapOrbitCorpusPermissions(effective),
      idempotencyKey,
      internalPrefix: "/api/internal/v1/grailscan/reference-datasets",
    });
    res.status(response.status).type(response.contentType).send(response.body);
  } catch (error) {
    if (error instanceof CorpusUpstreamError) {
      const normalized = normalizeUpstreamError(error);
      return res.status(normalized.status).json(normalized.body);
    }
    return sendCorpusProxyError(
      res,
      502,
      "reference_dataset_upstream_unavailable",
      "Reference Dataset service is temporarily unavailable",
    );
  }
});
export default router;
