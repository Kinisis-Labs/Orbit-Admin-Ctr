import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _topExceptionsCache,
  buildTopExceptionsCacheKey,
  fetchTopExceptions,
} from "./azureMonitor.js";
import type { AppRecord } from "../routes/orbit.js";

const FAKE_APP: AppRecord = {
  id: "test-app",
  name: "Test App",
  environment: "prod",
  region: "eastus2",
  resourceGroup: "rg-test",
  subscriptionId: "00000000-0000-0000-0000-000000000000",
  tags: {},
  status: "healthy",
  activeAlerts: 0,
  monthToDateCost: 0,
  userAuth: "none",
  owners: [],
};

const FAKE_EXCEPTIONS = [
  { message: "System.NullReferenceException: Object reference not set", count: 42, lastSeen: "2026-06-08T10:00:00Z" },
];

describe("buildTopExceptionsCacheKey", () => {
  test("produces the expected key format: appId:hours:limit", () => {
    assert.equal(buildTopExceptionsCacheKey("my-app", 24, 5), "my-app:24:5");
    assert.equal(buildTopExceptionsCacheKey("grailbabe", 48, 10), "grailbabe:48:10");
    assert.equal(buildTopExceptionsCacheKey("orbit", 1, 3), "orbit:1:3");
  });

  test("key is distinct for different appIds", () => {
    const k1 = buildTopExceptionsCacheKey("app-a", 24, 5);
    const k2 = buildTopExceptionsCacheKey("app-b", 24, 5);
    assert.notEqual(k1, k2);
  });

  test("key is distinct for different hours values", () => {
    const k1 = buildTopExceptionsCacheKey("app", 24, 5);
    const k2 = buildTopExceptionsCacheKey("app", 48, 5);
    assert.notEqual(k1, k2);
  });

  test("key is distinct for different limit values", () => {
    const k1 = buildTopExceptionsCacheKey("app", 24, 5);
    const k2 = buildTopExceptionsCacheKey("app", 24, 10);
    assert.notEqual(k1, k2);
  });
});

describe("_topExceptionsCache eviction", () => {
  beforeEach(() => {
    _topExceptionsCache.clear();
  });

  test("cache key written at storage time matches the key used for eviction", () => {
    const hours = 24;
    const limit = 5;
    const writeKey = buildTopExceptionsCacheKey(FAKE_APP.id, hours, limit);

    _topExceptionsCache.set(writeKey, {
      result: FAKE_EXCEPTIONS,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    assert.ok(_topExceptionsCache.has(writeKey), "entry must be present after write");

    // The delete path inside fetchTopExceptions uses the same key builder, so
    // deleting with the same inputs must remove the entry.
    const evictKey = buildTopExceptionsCacheKey(FAKE_APP.id, hours, limit);
    _topExceptionsCache.delete(evictKey);

    assert.ok(!_topExceptionsCache.has(writeKey), "entry must be gone after eviction with matching key");
  });

  test("bypassCache=true evicts the matching cache entry even when Monitor is not configured", async () => {
    const hours = 24;
    const limit = 5;
    const key = buildTopExceptionsCacheKey(FAKE_APP.id, hours, limit);

    _topExceptionsCache.set(key, {
      result: FAKE_EXCEPTIONS,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    assert.ok(_topExceptionsCache.has(key), "entry must be present before call");

    // Monitor is not configured in tests (no env vars) so fetchTopExceptions
    // returns null, but the eviction must still run before the config guard.
    const result = await fetchTopExceptions(FAKE_APP, { hours, limit, bypassCache: true });

    assert.equal(result, null, "returns null when Monitor is not configured");
    assert.ok(!_topExceptionsCache.has(key), "cache entry must be evicted despite Monitor being unconfigured");
  });

  test("bypassCache=false does NOT evict a fresh cache entry (cache hit)", async () => {
    const hours = 24;
    const limit = 5;
    const key = buildTopExceptionsCacheKey(FAKE_APP.id, hours, limit);

    _topExceptionsCache.set(key, {
      result: FAKE_EXCEPTIONS,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // With bypassCache=false the entry must survive the call (Monitor returns
    // null early, but the eviction branch is not entered).
    await fetchTopExceptions(FAKE_APP, { hours, limit, bypassCache: false });

    assert.ok(_topExceptionsCache.has(key), "fresh cache entry must survive a non-bypass call");
  });

  test("only the targeted key is evicted; sibling keys (different hours/limit) are untouched", async () => {
    const key24_5 = buildTopExceptionsCacheKey(FAKE_APP.id, 24, 5);
    const key48_5 = buildTopExceptionsCacheKey(FAKE_APP.id, 48, 5);
    const key24_10 = buildTopExceptionsCacheKey(FAKE_APP.id, 24, 10);

    const future = Date.now() + 5 * 60 * 1000;
    _topExceptionsCache.set(key24_5, { result: FAKE_EXCEPTIONS, fetchedAt: Date.now(), expiresAt: future });
    _topExceptionsCache.set(key48_5, { result: FAKE_EXCEPTIONS, fetchedAt: Date.now(), expiresAt: future });
    _topExceptionsCache.set(key24_10, { result: FAKE_EXCEPTIONS, fetchedAt: Date.now(), expiresAt: future });

    // Evict only the 24h/5-limit variant.
    await fetchTopExceptions(FAKE_APP, { hours: 24, limit: 5, bypassCache: true });

    assert.ok(!_topExceptionsCache.has(key24_5), "targeted key must be evicted");
    assert.ok(_topExceptionsCache.has(key48_5), "sibling 48h key must be untouched");
    assert.ok(_topExceptionsCache.has(key24_10), "sibling limit=10 key must be untouched");
  });
});
