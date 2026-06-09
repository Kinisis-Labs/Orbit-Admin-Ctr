import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AppConfigurationClient, GetConfigurationSettingResponse } from "@azure/app-configuration";
import {
  _flagCache,
  _setAppConfigClientForTest,
  getAppConfigFeatureFlag,
} from "./appConfig.js";

function makeClient(
  impl: (key: string) => Promise<GetConfigurationSettingResponse>,
): AppConfigurationClient {
  return {
    getConfigurationSetting: ({ key }: { key: string }) => impl(key),
  } as unknown as AppConfigurationClient;
}

function makeFlagResponse(enabled: boolean): GetConfigurationSettingResponse {
  return {
    value: JSON.stringify({ id: "test-flag", enabled }),
    key: ".appconfig.featureflag/test-flag",
  } as unknown as GetConfigurationSettingResponse;
}

function notFoundError(): Error {
  const e = new Error("Not found") as Error & { code?: string };
  e.code = "ConfigurationSettingNotFound";
  return e;
}

function networkError(): Error {
  return new Error("ECONNREFUSED");
}

const ENDPOINT = "https://appcs-test.azconfig.io";
const FLAG = "my-feature";

describe("getAppConfigFeatureFlag — feature flag cache", () => {
  const originalEndpoint = process.env.APP_CONFIGURATION_ENDPOINT;
  const originalTtl = process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS;

  beforeEach(() => {
    _flagCache.clear();
    _setAppConfigClientForTest(null);
    process.env.APP_CONFIGURATION_ENDPOINT = ENDPOINT;
    delete process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS;
  });

  afterEach(() => {
    _flagCache.clear();
    _setAppConfigClientForTest(null);
    if (originalEndpoint === undefined) {
      delete process.env.APP_CONFIGURATION_ENDPOINT;
    } else {
      process.env.APP_CONFIGURATION_ENDPOINT = originalEndpoint;
    }
    if (originalTtl === undefined) {
      delete process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS;
    } else {
      process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS = originalTtl;
    }
  });

  test("cache hit: second call returns cached value and does not invoke the SDK again", async () => {
    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        return makeFlagResponse(false);
      }),
    );

    const first = await getAppConfigFeatureFlag(FLAG);
    const second = await getAppConfigFeatureFlag(FLAG);

    assert.equal(first, false, "first call must return false (flag disabled)");
    assert.equal(second, false, "second call must return the same cached value");
    assert.equal(calls, 1, "SDK must only be called once (second call is a cache hit)");
  });

  test("cache miss after TTL expiry: a fresh SDK call is made when the cached entry has expired", async () => {
    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        return makeFlagResponse(true);
      }),
    );

    _flagCache.set(FLAG, { value: false, expiresAt: Date.now() - 1 });

    const result = await getAppConfigFeatureFlag(FLAG);

    assert.equal(result, true, "must return live value from SDK after cache expiry");
    assert.equal(calls, 1, "SDK must be called once after the expired entry is ignored");
    const entry = _flagCache.get(FLAG);
    assert.ok(entry !== undefined, "a fresh entry must be written into the cache");
    assert.ok(entry.expiresAt > Date.now(), "fresh entry must have a future expiresAt");
  });

  test("TTL=0 disables caching: every call hits the SDK and nothing is written to the cache", async () => {
    process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS = "0";

    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        return makeFlagResponse(true);
      }),
    );

    await getAppConfigFeatureFlag(FLAG);
    await getAppConfigFeatureFlag(FLAG);

    assert.equal(calls, 2, "SDK must be called on every request when TTL=0");
    assert.equal(_flagCache.size, 0, "nothing must be written to the cache when TTL=0");
  });

  test('"not found" result is cached: subsequent calls do not hit the SDK again', async () => {
    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        throw notFoundError();
      }),
    );

    const first = await getAppConfigFeatureFlag(FLAG);
    const second = await getAppConfigFeatureFlag(FLAG);

    assert.equal(first, true, '"not found" must fall back to true (safe default)');
    assert.equal(second, true, "second call must return the same cached true");
    assert.equal(calls, 1, "SDK must only be called once; not-found result is cached");
  });

  test("network error result is cached and falls back to true", async () => {
    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        throw networkError();
      }),
    );

    const first = await getAppConfigFeatureFlag(FLAG);
    const second = await getAppConfigFeatureFlag(FLAG);

    assert.equal(first, true, "network error must fall back to true (safe default)");
    assert.equal(second, true, "second call must return the same cached true");
    assert.equal(calls, 1, "SDK must only be called once; error fallback is cached");
    const entry = _flagCache.get(FLAG);
    assert.ok(entry !== undefined, "error fallback must be written to the cache");
    assert.equal(entry.value, true, "cached error fallback value must be true");
  });

  test("not configured: returns true immediately without touching the SDK", async () => {
    delete process.env.APP_CONFIGURATION_ENDPOINT;

    let calls = 0;
    _setAppConfigClientForTest(
      makeClient(async () => {
        calls++;
        return makeFlagResponse(false);
      }),
    );

    const result = await getAppConfigFeatureFlag(FLAG);

    assert.equal(result, true, "must return true when App Configuration is not configured");
    assert.equal(calls, 0, "SDK must never be called when endpoint is not set");
  });

  test("distinct flag names are cached independently", async () => {
    let callsA = 0;
    let callsB = 0;
    _setAppConfigClientForTest(
      makeClient(async (key) => {
        if (key.endsWith("flag-a")) {
          callsA++;
          return makeFlagResponse(false);
        }
        callsB++;
        return makeFlagResponse(true);
      }),
    );

    await getAppConfigFeatureFlag("flag-a");
    await getAppConfigFeatureFlag("flag-b");
    await getAppConfigFeatureFlag("flag-a");
    await getAppConfigFeatureFlag("flag-b");

    assert.equal(callsA, 1, "flag-a SDK call must be deduplicated by cache");
    assert.equal(callsB, 1, "flag-b SDK call must be deduplicated by cache");
    assert.equal(_flagCache.size, 2, "one cache entry per distinct flag name");
  });
});
