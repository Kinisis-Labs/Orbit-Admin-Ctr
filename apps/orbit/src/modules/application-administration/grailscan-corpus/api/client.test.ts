import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { corpusApi, CorpusApiError, createIdempotencyKey } from "./client.js";

test("creates operation-scoped idempotency keys", () => {
  const key = createIdempotencyKey("submission");
  assert.match(key, /^submission:[0-9a-f-]{36}$/);
});

test("preserves normalized correlation details from Orbit errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "golden_corpus_review_claim_conflict",
          message: "Claim conflict",
          correlationId: "request-123",
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(
      corpusApi("/overview", z.object({ ok: z.boolean() })),
      (error: unknown) =>
        error instanceof CorpusApiError &&
        error.code === "golden_corpus_review_claim_conflict" &&
        error.correlationId === "request-123" &&
        error.status === 409,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards review mutation idempotency and JSON headers", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(
      JSON.stringify({ groupId: "11111111-1111-4111-8111-111111111111", status: "rejected" }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  try {
    await corpusApi(
      "/groups/11111111-1111-4111-8111-111111111111/reject",
      z.object({ groupId: z.string().uuid(), status: z.string() }),
      {
        method: "POST",
        headers: { "idempotency-key": "review-reject:11111111-1111-4111-8111-111111111111" },
        body: JSON.stringify({ reasonCode: "poor_quality" }),
      },
    );
    assert.equal(
      request?.url,
      "/api/grailscan-corpus/groups/11111111-1111-4111-8111-111111111111/reject",
    );
    const headers = new Headers(request?.init?.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(
      headers.get("idempotency-key"),
      "review-reject:11111111-1111-4111-8111-111111111111",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime-validates successful browser DTOs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ wrong: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    await assert.rejects(corpusApi("/overview", z.object({ ok: z.boolean() })), z.ZodError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
