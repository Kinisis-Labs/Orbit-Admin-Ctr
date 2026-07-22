import { createHash, createHmac } from "node:crypto";

const INTERNAL_PREFIX = "/api/internal/v1/grailscan/corpus";

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function decodePercentOnly(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, "%2B"));
}

export function canonicalizeCorpusPath(path: string): string {
  if (!path.startsWith(INTERNAL_PREFIX)) throw new Error("invalid_canonical_path");
  return path
    .split("/")
    .map((segment) => {
      const decoded = decodePercentOnly(segment);
      if (decoded === "." || decoded === "..") throw new Error("ambiguous_path_segment");
      return encodeRfc3986(decoded);
    })
    .join("/");
}

export function canonicalizeCorpusQuery(query: string): string {
  if (!query) return "";
  return query
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      const name = separator === -1 ? pair : pair.slice(0, separator);
      const value = separator === -1 ? "" : pair.slice(separator + 1);
      return [
        encodeRfc3986(decodePercentOnly(name)),
        encodeRfc3986(decodePercentOnly(value)),
      ] as const;
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue)
        : leftName.localeCompare(rightName),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildCorpusCanonicalPayload(input: {
  method: string;
  path: string;
  query: string;
  contentSha256: string;
  actorId: string;
  permissions: readonly string[];
  timestamp: string;
  requestId: string;
}): string {
  return [
    "v1",
    input.method.toUpperCase(),
    canonicalizeCorpusPath(input.path),
    canonicalizeCorpusQuery(input.query),
    input.contentSha256,
    input.actorId,
    [...new Set(input.permissions)].sort().join(","),
    input.timestamp,
    input.requestId,
  ].join("\n");
}

export function signCorpusRequest(payload: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(Buffer.from(payload, "utf8"))
    .digest("hex");
}
