import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCorpusCanonicalPayload,
  canonicalizeCorpusQuery,
  sha256Hex,
  signCorpusRequest,
} from "./signing.js";

const input = {
  method: "POST",
  path: "/api/internal/v1/grailscan/corpus/submissions",
  query: "z=last&a=hello+world&a=hello%20world&empty",
  contentSha256: sha256Hex(Buffer.from('{"sourceType":"founder"}', "utf8")),
  actorId: "00000000-0000-4000-8000-000000000001",
  permissions: ["grailscan.corpus.upload", "grailscan.corpus.read"],
  timestamp: "2026-07-21T21:00:00.000Z",
  requestId: "00000000-0000-4000-8000-000000000002",
};

test("canonicalizes duplicate query pairs without treating plus as space", () => {
  assert.equal(
    canonicalizeCorpusQuery(input.query),
    "a=hello%20world&a=hello%2Bworld&empty=&z=last",
  );
});

test("builds and signs the exact canonical payload", () => {
  const payload = buildCorpusCanonicalPayload(input);
  assert.equal(
    payload,
    [
      "v1",
      "POST",
      input.path,
      "a=hello%20world&a=hello%2Bworld&empty=&z=last",
      input.contentSha256,
      input.actorId,
      "grailscan.corpus.read,grailscan.corpus.upload",
      input.timestamp,
      input.requestId,
    ].join("\n"),
  );
  assert.match(signCorpusRequest(payload, "test-secret"), /^[a-f0-9]{64}$/);
});
