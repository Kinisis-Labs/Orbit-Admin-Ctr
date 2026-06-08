import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _appInsightsIdCache,
  _timeSeriesCache,
  evictAppTimeSeries,
} from "./azureMonitor.js";

const APP_ID = "test-app";
const RESOURCE_ID = "/subscriptions/00000000/resourceGroups/rg-test/providers/microsoft.insights/components/appi-test";
const OTHER_RESOURCE_ID = "/subscriptions/00000000/resourceGroups/rg-other/providers/microsoft.insights/components/appi-other";

const FAKE_POINTS = [{ timestamp: "2026-06-08T10:00:00Z", value: 1.5 }];
const FUTURE = Date.now() + 5 * 60 * 1000;

/** Helper: store a valid resource ID entry that has not yet expired. */
function setIdEntry(appId: string, id: string | null): void {
  _appInsightsIdCache.set(appId, { id, expiresAt: FUTURE });
}

describe("evictAppTimeSeries", () => {
  beforeEach(() => {
    _appInsightsIdCache.clear();
    _timeSeriesCache.clear();
  });

  test("evicts all _timeSeriesCache entries for the app's resource ID", () => {
    setIdEntry(APP_ID, RESOURCE_ID);
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });
    _timeSeriesCache.set(`${RESOURCE_ID}:p95_latency_ms:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });
    _timeSeriesCache.set(`${RESOURCE_ID}:error_rate_pct:48`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    evictAppTimeSeries(APP_ID);

    assert.equal(_timeSeriesCache.size, 0, "all entries for the app must be evicted");
  });

  test("does not touch cache entries belonging to a different resource ID", () => {
    setIdEntry(APP_ID, RESOURCE_ID);
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });
    _timeSeriesCache.set(`${OTHER_RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    evictAppTimeSeries(APP_ID);

    assert.ok(!_timeSeriesCache.has(`${RESOURCE_ID}:requests_per_min:24`), "target app entry must be evicted");
    assert.ok(_timeSeriesCache.has(`${OTHER_RESOURCE_ID}:requests_per_min:24`), "other app entry must be untouched");
  });

  test("is a no-op when the app has no cached resource ID", () => {
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    evictAppTimeSeries(APP_ID);

    assert.equal(_timeSeriesCache.size, 1, "cache must be untouched when no resource ID is cached for the app");
  });

  test("is a no-op when the app's resource ID is null (lookup previously failed)", () => {
    setIdEntry(APP_ID, null);
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    evictAppTimeSeries(APP_ID);

    assert.equal(_timeSeriesCache.size, 1, "cache must be untouched when cached resource ID is null");
  });

  test("eviction uses the resource-ID present at call time, before the ID cache is cleared", () => {
    setIdEntry(APP_ID, RESOURCE_ID);
    _timeSeriesCache.set(`${RESOURCE_ID}:cpu_pct:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });
    _timeSeriesCache.set(`${RESOURCE_ID}:memory_pct:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    // Simulate the sequence fetchAppTimeSeries uses: evict first, then clear ID cache.
    evictAppTimeSeries(APP_ID);
    _appInsightsIdCache.delete(APP_ID);

    assert.ok(!_timeSeriesCache.has(`${RESOURCE_ID}:cpu_pct:24`), "cpu_pct entry must be evicted");
    assert.ok(!_timeSeriesCache.has(`${RESOURCE_ID}:memory_pct:24`), "memory_pct entry must be evicted");
    assert.ok(!_appInsightsIdCache.has(APP_ID), "resource-ID cache must be cleared after eviction");
  });

  test("clearing the resource-ID cache first makes eviction a no-op (demonstrates why order matters)", () => {
    setIdEntry(APP_ID, RESOURCE_ID);
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    // Wrong order: clear ID cache first, then try to evict — entries survive.
    _appInsightsIdCache.delete(APP_ID);
    evictAppTimeSeries(APP_ID);

    assert.equal(_timeSeriesCache.size, 1, "entries survive when resource-ID cache is cleared before eviction");
  });

  test("is idempotent — calling twice leaves the cache in the same state", () => {
    setIdEntry(APP_ID, RESOURCE_ID);
    _timeSeriesCache.set(`${RESOURCE_ID}:requests_per_min:24`, { result: FAKE_POINTS, fetchedAt: Date.now(), expiresAt: FUTURE });

    evictAppTimeSeries(APP_ID);
    evictAppTimeSeries(APP_ID);

    assert.equal(_timeSeriesCache.size, 0, "cache must be empty after two calls");
  });
});
