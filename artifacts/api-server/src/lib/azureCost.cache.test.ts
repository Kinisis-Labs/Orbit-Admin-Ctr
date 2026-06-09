import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _costCache,
  clearCostCacheForApp,
  fetchMonthToDateCost,
} from "./azureCost.js";
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

const FAKE_COST_RESULT = {
  monthToDate: 42.5,
  byService: [{ service: "Azure Container Apps", amount: 42.5 }],
  daily: [],
  dataAsOf: "2026-06-08",
};

describe("_costCache eviction", () => {
  beforeEach(() => {
    _costCache.clear();
  });

  test("cache key is app.id — written key matches eviction key used by clearCostCacheForApp", () => {
    _costCache.set(FAKE_APP.id, {
      result: FAKE_COST_RESULT,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    assert.ok(_costCache.has(FAKE_APP.id), "entry must be present after write");

    clearCostCacheForApp(FAKE_APP.id);

    assert.ok(!_costCache.has(FAKE_APP.id), "entry must be gone after clearCostCacheForApp");
  });

  test("clearCostCacheForApp only removes the targeted app; other apps are untouched", () => {
    const otherAppId = "other-app";
    const future = Date.now() + 30 * 60 * 1000;

    _costCache.set(FAKE_APP.id, { result: FAKE_COST_RESULT, expiresAt: future });
    _costCache.set(otherAppId, { result: FAKE_COST_RESULT, expiresAt: future });

    clearCostCacheForApp(FAKE_APP.id);

    assert.ok(!_costCache.has(FAKE_APP.id), "targeted app entry must be evicted");
    assert.ok(_costCache.has(otherAppId), "sibling app entry must be untouched");
  });

  test("bypassCache=true evicts the matching cache entry even when Azure is not configured", async () => {
    _costCache.set(FAKE_APP.id, {
      result: FAKE_COST_RESULT,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    assert.ok(_costCache.has(FAKE_APP.id), "entry must be present before call");

    // Azure is not configured in tests (no AZURE_SUBSCRIPTION_IDS env var), so
    // fetchMonthToDateCost returns null, but the eviction must still run before
    // the config guard.
    const result = await fetchMonthToDateCost(FAKE_APP, { bypassCache: true });

    assert.equal(result, null, "returns null when Azure is not configured");
    assert.ok(!_costCache.has(FAKE_APP.id), "cache entry must be evicted despite Azure being unconfigured");
  });

  test("bypassCache=false does NOT evict a fresh cache entry (cache hit)", async () => {
    _costCache.set(FAKE_APP.id, {
      result: FAKE_COST_RESULT,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    // With bypassCache=false the entry must survive the call (Azure returns
    // null early due to no config, but the eviction branch is not entered).
    await fetchMonthToDateCost(FAKE_APP, { bypassCache: false });

    assert.ok(_costCache.has(FAKE_APP.id), "fresh cache entry must survive a non-bypass call");
  });

  test("bypassCache=true on one app does not evict sibling app entries", async () => {
    const otherAppId = "other-app";
    const future = Date.now() + 30 * 60 * 1000;

    _costCache.set(FAKE_APP.id, { result: FAKE_COST_RESULT, expiresAt: future });
    _costCache.set(otherAppId, { result: FAKE_COST_RESULT, expiresAt: future });

    await fetchMonthToDateCost(FAKE_APP, { bypassCache: true });

    assert.ok(!_costCache.has(FAKE_APP.id), "targeted app entry must be evicted");
    assert.ok(_costCache.has(otherAppId), "sibling app entry must be untouched");
  });

  test("bypassCache=true on an already-empty cache does not throw", async () => {
    assert.ok(!_costCache.has(FAKE_APP.id), "cache must start empty");

    await assert.doesNotReject(
      () => fetchMonthToDateCost(FAKE_APP, { bypassCache: true }),
      "calling with bypassCache=true on an empty cache must not throw",
    );
  });
});
