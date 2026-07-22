import { randomUUID } from "node:crypto";
import type { SessionUser } from "../../lib/session.js";
import { readGrailScanCorpusProxyConfig } from "./config.js";
import { isCorpusErrorBody } from "./errors.js";
import type { GrailBabeCorpusPermission } from "./permissions.js";
import { assertExpectedCorpusResponse } from "./validation.js";
import {
  buildCorpusCanonicalPayload,
  canonicalizeCorpusQuery,
  sha256Hex,
  signCorpusRequest,
} from "./signing.js";

const INTERNAL_PREFIX = "/api/internal/v1/grailscan/corpus";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface CorpusProxyResponse {
  status: number;
  body: unknown;
  contentType: string;
}

export class CorpusUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super("grailscan_corpus_upstream_error");
  }
}

export async function requestGrailBabeCorpus(input: {
  method: string;
  path: string;
  rawQuery: string;
  body: unknown;
  actor: SessionUser;
  backendPermissions: readonly GrailBabeCorpusPermission[];
  idempotencyKey?: string;
  internalPrefix?: string;
}): Promise<CorpusProxyResponse> {
  const config = readGrailScanCorpusProxyConfig();
  const method = input.method.toUpperCase();
  const internalPrefix = input.internalPrefix ?? INTERNAL_PREFIX;
  const path = `${internalPrefix}${input.path === "/" ? "" : input.path}`;
  const query = canonicalizeCorpusQuery(input.rawQuery);
  const bodyBytes =
    method === "GET" || method === "HEAD"
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(input.body ?? {}), "utf8");
  const contentSha256 = sha256Hex(bodyBytes);
  const timestamp = new Date().toISOString();
  const requestId = randomUUID();
  const permissions = [...new Set(input.backendPermissions)].sort();
  const payload = buildCorpusCanonicalPayload({
    method,
    path,
    query,
    contentSha256,
    actorId: input.actor.id,
    permissions,
    timestamp,
    requestId,
  });
  const signature = signCorpusRequest(payload, config.signingSecret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${config.internalToken}`,
      "x-orbit-signature-version": "v1",
      "x-orbit-content-sha256": contentSha256,
      "x-orbit-actor-id": input.actor.id,
      "x-orbit-permissions": permissions.join(","),
      "x-orbit-timestamp": timestamp,
      "x-orbit-request-id": requestId,
      "x-orbit-signature": signature,
    };
    if (bodyBytes.length > 0) headers["content-type"] = "application/json";
    if (input.idempotencyKey) headers["idempotency-key"] = input.idempotencyKey;
    const response = await fetch(`${config.baseUrl}${path}${query ? `?${query}` : ""}`, {
      method,
      headers,
      body: bodyBytes.length > 0 ? bodyBytes : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error("grailscan_corpus_response_too_large");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("grailscan_corpus_response_too_large");
    }
    const body: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) throw new CorpusUpstreamError(response.status, body);
    assertExpectedCorpusResponse(input.path, body);
    return {
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "application/json",
    };
  } catch (error) {
    if (error instanceof CorpusUpstreamError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("grailscan_corpus_upstream_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeUpstreamError(error: CorpusUpstreamError): {
  status: number;
  body: unknown;
} {
  if (isCorpusErrorBody(error.body)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.body.error.code,
          message: error.body.error.message,
          correlationId: error.body.error.correlationId ?? null,
          ...(error.body.error.details === undefined ? {} : { details: error.body.error.details }),
        },
      },
    };
  }
  return {
    status: 502,
    body: {
      error: {
        code: "grailscan_corpus_invalid_upstream_error",
        message: "Golden Corpus returned an invalid error response",
        correlationId: null,
      },
    },
  };
}
