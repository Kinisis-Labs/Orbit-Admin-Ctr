export interface GrailScanCorpusProxyConfig {
  baseUrl: string;
  internalToken: string;
  signingSecret: string;
  timeoutMs: number;
}

export function readGrailScanCorpusProxyConfig(): GrailScanCorpusProxyConfig {
  const baseUrl = process.env.GRAILBABE_INTERNAL_BASE_URL?.trim();
  const internalToken = process.env.GRAILBABE_INTERNAL_API_TOKEN?.trim();
  const signingSecret = process.env.ORBIT_ACTOR_SIGNING_SECRET?.trim();
  if (!baseUrl || !internalToken || !signingSecret) {
    throw new Error("grailscan_corpus_proxy_unconfigured");
  }
  const url = new URL(baseUrl);
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    throw new Error("grailscan_corpus_proxy_requires_https");
  }
  const timeout = Number(process.env.GRAILBABE_INTERNAL_TIMEOUT_MS ?? 15_000);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    internalToken,
    signingSecret,
    timeoutMs:
      Number.isInteger(timeout) && timeout >= 1_000 && timeout <= 60_000 ? timeout : 15_000,
  };
}
