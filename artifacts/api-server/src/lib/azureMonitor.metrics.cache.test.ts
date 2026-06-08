import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _timeSeriesCache,
  _metricsCache,
  fetchMetricTimeSeries,
  fetchAppMetrics,
} from "./azureMonitor.js";
import type { AppRecord } from "../routes/orbit.js";
import type { TelemetrySummary } from "./azureMonitor.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const RESOURCE_ID =
  "/subscriptions/00000000/resourceGroups/rg-test/providers/microsoft.insights/components/appi-test";
const OTHER_RESOURCE_ID =
  "/subscriptions/00000000/resourceGroups/rg-other/providers/microsoft.insights/components/appi-other";

const FAKE_POINTS = [{ timestamp: "2026-06-08T10:00:00Z", value: 1.5 }];
const FUTURE = Date.now() + 5 * 60 * 1000;

const FAKE_SUMMARY: TelemetrySummary = {
  requestsPerMin: 42,
  p95LatencyMs: 120,
  errorRatePct: 0.5,
  availabilityPct: 99.9,
  cpuPct: 30,
  memoryPct: 45,
};

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

const OTHER_APP: AppRecord = {
  ...FAKE_APP,
  id: "other-app",
  name: "Other App",
};

// ---------------------------------------------------------------------------
// _timeSeriesCache — key scheme (format assertions)
// ---------------------------------------------------------------------------

describe("_timeSeriesCache key scheme (fetchMetricTimeSeries format)", () => {
  test("key is distinct for different metricNames (same resourceId and hours)", () => {
    const k1 = `${RESOURCE_ID}:requests_per_min:24`;
    const k2 = `${RESOURCE_ID}:p95_latency_ms:24`;
    assert.notEqual(k1, k2);
  });

  test("key is distinct for different hours values (same resourceId and metricName)", () => {
    const k1 = `${RESOURCE_ID}:cpu_pct:24`;
    const k2 = `${RESOURCE_ID}:cpu_pct:48`;
    assert.notEqual(k1, k2);
  });

  test("key is distinct for different resourceIds (same metricName and hours)", () => {
    const k1 = `${RESOURCE_ID}:cpu_pct:24`;
    const k2 = `${OTHER_RESOURCE_ID}:cpu_pct:24`;
    assert.notEqual(k1, k2);
  });
});

// ---------------------------------------------------------------------------
// _timeSeriesCache — eviction via fetchMetricTimeSeries
//
// fetchMetricTimeSeries now evicts BEFORE the isMonitorConfigured() guard so
// bypassCache=true always clears the stale entry (even when Monitor is
// unconfigured in tests). The function returns null in unconfigured mode, but
// the eviction still runs — identical to the fetchTopExceptions pattern.
// ---------------------------------------------------------------------------

describe("_timeSeriesCache eviction via fetchMetricTimeSeries", () => {
  beforeEach(() => {
    _timeSeriesCache.clear();
  });

  test("bypassCache=true evicts the matching entry even when Monitor is not configured", async () => {
    const key = `${RESOURCE_ID}:cpu_pct:24`;
    _timeSeriesCache.set(key, { result: FAKE_POINTS, expiresAt: FUTURE });

    assert.ok(_timeSeriesCache.has(key), "entry must be present before call");

    const result = await fetchMetricTimeSeries(RESOURCE_ID, "cpu_pct", 24, { bypassCache: true });

    assert.equal(result, null, "returns null when Monitor is not configured");
    assert.ok(!_timeSeriesCache.has(key), "cache entry must be evicted despite Monitor being unconfigured");
  });

  test("bypassCache=true evicts only the targeted key; sibling metric/hours keys are untouched", async () => {
    const targetKey = `${RESOURCE_ID}:cpu_pct:24`;
    const siblingMetric = `${RESOURCE_ID}:memory_pct:24`;
    const siblingHours = `${RESOURCE_ID}:cpu_pct:48`;
    const otherResource = `${OTHER_RESOURCE_ID}:cpu_pct:24`;

    _timeSeriesCache.set(targetKey, { result: FAKE_POINTS, expiresAt: FUTURE });
    _timeSeriesCache.set(siblingMetric, { result: FAKE_POINTS, expiresAt: FUTURE });
    _timeSeriesCache.set(siblingHours, { result: FAKE_POINTS, expiresAt: FUTURE });
    _timeSeriesCache.set(otherResource, { result: FAKE_POINTS, expiresAt: FUTURE });

    await fetchMetricTimeSeries(RESOURCE_ID, "cpu_pct", 24, { bypassCache: true });

    assert.ok(!_timeSeriesCache.has(targetKey), "targeted key must be evicted");
    assert.ok(_timeSeriesCache.has(siblingMetric), "sibling metric key must be untouched");
    assert.ok(_timeSeriesCache.has(siblingHours), "sibling hours key must be untouched");
    assert.ok(_timeSeriesCache.has(otherResource), "other-resource key must be untouched");
  });

  test("bypassCache=false does NOT evict a fresh cache entry (cache hit path)", async () => {
    const key = `${RESOURCE_ID}:cpu_pct:24`;
    _timeSeriesCache.set(key, { result: FAKE_POINTS, expiresAt: FUTURE });

    // With bypassCache=false the function returns null (unconfigured) without
    // touching the cache — the entry must survive.
    await fetchMetricTimeSeries(RESOURCE_ID, "cpu_pct", 24, { bypassCache: false });

    assert.ok(_timeSeriesCache.has(key), "fresh cache entry must survive a non-bypass call");
  });

  test("write key and eviction key are identical for the same inputs (no key-drift)", async () => {
    const metricName = "error_rate_pct";
    const hours = 24;
    const writeKey = `${RESOURCE_ID}:${metricName}:${hours}`;

    _timeSeriesCache.set(writeKey, { result: FAKE_POINTS, expiresAt: FUTURE });

    await fetchMetricTimeSeries(RESOURCE_ID, metricName, hours, { bypassCache: true });

    assert.ok(!_timeSeriesCache.has(writeKey), "entry must be gone after bypassCache=true with same inputs");
    assert.equal(_timeSeriesCache.size, 0, "no other entries should remain");
  });

  test("eviction is idempotent — calling twice leaves the cache in the same empty state", async () => {
    const key = `${RESOURCE_ID}:p95_latency_ms:24`;
    _timeSeriesCache.set(key, { result: FAKE_POINTS, expiresAt: FUTURE });

    await fetchMetricTimeSeries(RESOURCE_ID, "p95_latency_ms", 24, { bypassCache: true });
    await fetchMetricTimeSeries(RESOURCE_ID, "p95_latency_ms", 24, { bypassCache: true });

    assert.ok(!_timeSeriesCache.has(key), "entry must be absent after second bypass call");
    assert.equal(_timeSeriesCache.size, 0);
  });
});

// ---------------------------------------------------------------------------
// _metricsCache — eviction via fetchAppMetrics
//
// fetchAppMetrics now evicts BEFORE the isAzureConfigured() guard so
// bypassCache=true always clears the stale entry (even when Azure is
// unconfigured in tests). The function returns null in unconfigured mode, but
// the eviction still runs.
// ---------------------------------------------------------------------------

describe("_metricsCache eviction via fetchAppMetrics", () => {
  beforeEach(() => {
    _metricsCache.clear();
  });

  test("bypassCache=true evicts the matching entry even when Azure is not configured", async () => {
    _metricsCache.set(FAKE_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });

    assert.ok(_metricsCache.has(FAKE_APP.id), "entry must be present before call");

    const result = await fetchAppMetrics(FAKE_APP, { bypassCache: true });

    assert.equal(result, null, "returns null when Azure is not configured");
    assert.ok(!_metricsCache.has(FAKE_APP.id), "cache entry must be evicted despite Azure being unconfigured");
  });

  test("bypassCache=true evicts only the targeted app entry; sibling app entries are untouched", async () => {
    _metricsCache.set(FAKE_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });
    _metricsCache.set(OTHER_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });

    await fetchAppMetrics(FAKE_APP, { bypassCache: true });

    assert.ok(!_metricsCache.has(FAKE_APP.id), "targeted app entry must be evicted");
    assert.ok(_metricsCache.has(OTHER_APP.id), "sibling app entry must be untouched");
    assert.equal(_metricsCache.size, 1, "only one entry must have been removed");
  });

  test("bypassCache=false does NOT evict a fresh cache entry (cache hit path)", async () => {
    _metricsCache.set(FAKE_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });

    // With bypassCache=false the function returns null (unconfigured) without
    // touching the cache — the entry must survive.
    await fetchAppMetrics(FAKE_APP, { bypassCache: false });

    assert.ok(_metricsCache.has(FAKE_APP.id), "fresh cache entry must survive a non-bypass call");
  });

  test("write key and eviction key are identical for the same app.id (no key-drift)", async () => {
    _metricsCache.set(FAKE_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });

    await fetchAppMetrics(FAKE_APP, { bypassCache: true });

    assert.ok(!_metricsCache.has(FAKE_APP.id), "entry must be gone after bypassCache=true");
    assert.equal(_metricsCache.size, 0, "no other entries should remain");
  });

  test("eviction is idempotent — calling twice leaves the cache in the same empty state", async () => {
    _metricsCache.set(FAKE_APP.id, { result: FAKE_SUMMARY, expiresAt: FUTURE });

    await fetchAppMetrics(FAKE_APP, { bypassCache: true });
    await fetchAppMetrics(FAKE_APP, { bypassCache: true });

    assert.ok(!_metricsCache.has(FAKE_APP.id), "entry must be absent after second bypass call");
    assert.equal(_metricsCache.size, 0);
  });
});
