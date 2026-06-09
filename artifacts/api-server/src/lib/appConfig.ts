/**
 * Azure App Configuration helper.
 *
 * Reads settings and feature flags from the Azure App Configuration store
 * (`appcs-orbit-prod-eus2`) when `APP_CONFIGURATION_ENDPOINT` is set.
 * Falls back silently when the store is not configured or unreachable.
 *
 * Authentication is via `DefaultAzureCredential` — the same managed identity
 * (`id-orbit-api-prod`) that drives the rest of the Azure integrations.
 *
 * Env:
 *   APP_CONFIGURATION_ENDPOINT — URL of the App Configuration store
 *     (e.g. https://appcs-orbit-prod-eus2.azconfig.io). When absent,
 *     `getAppConfigSetting()` always returns null and
 *     `getAppConfigFeatureFlag()` always returns true (enabled).
 *   APP_CONFIG_FEATURE_FLAG_TTL_SECONDS — TTL for the in-process feature flag
 *     cache (default 60). Set to 0 to disable caching entirely.
 *   APP_CONFIG_SETTING_TTL_SECONDS — TTL for the in-process settings cache
 *     (default 60). Set to 0 to disable caching entirely. Null results
 *     (missing keys) are also cached to avoid repeated lookups.
 *
 * Feature flags:
 *   Azure App Configuration stores feature flags at the key prefix
 *   `.appconfig.featureflag/<flagName>` with a JSON value:
 *     { "id": "<flagName>", "description": "", "enabled": true }
 *   `getAppConfigFeatureFlag(flagName)` returns `true` when the flag is
 *   enabled, `false` when explicitly disabled, and `true` (safe fallback) when
 *   the flag is absent or App Configuration is unreachable. This means all
 *   surfaces remain visible in dev/mock mode and are only toggled off by an
 *   explicit `"enabled": false` entry in the store.
 *
 *   Results are cached in-process for `APP_CONFIG_FEATURE_FLAG_TTL_SECONDS`
 *   seconds (default 60) to avoid a live network call on every request.
 */

import { AppConfigurationClient } from "@azure/app-configuration";
import { getAzureCredential } from "./azure.js";
import { logger } from "./logger.js";

let _client: AppConfigurationClient | null = null;

interface FlagCacheEntry {
  value: boolean;
  expiresAt: number;
}

interface SettingCacheEntry {
  value: string | null;
  expiresAt: number;
}

export const _flagCache = new Map<string, FlagCacheEntry>();
const _settingCache = new Map<string, SettingCacheEntry>();

/** Inject a mock client in tests. Pass `null` to reset to the real lazy-init path. */
export function _setAppConfigClientForTest(client: AppConfigurationClient | null): void {
  _client = client;
}

function getFlagTtlMs(): number {
  const raw = process.env.APP_CONFIG_FEATURE_FLAG_TTL_SECONDS;
  const seconds = raw !== undefined ? Number(raw) : 60;
  return (isNaN(seconds) ? 60 : seconds) * 1000;
}

function getSettingTtlMs(): number {
  const raw = process.env.APP_CONFIG_SETTING_TTL_SECONDS;
  const seconds = raw !== undefined ? Number(raw) : 60;
  return (isNaN(seconds) ? 60 : seconds) * 1000;
}

export function isAppConfigConfigured(): boolean {
  return Boolean(process.env.APP_CONFIGURATION_ENDPOINT);
}

function getClient(): AppConfigurationClient {
  if (!_client) {
    const endpoint = process.env.APP_CONFIGURATION_ENDPOINT!;
    _client = new AppConfigurationClient(endpoint, getAzureCredential());
  }
  return _client;
}

/**
 * Returns the string value of a setting from App Configuration, or `null` if:
 *   - App Configuration is not configured (`APP_CONFIGURATION_ENDPOINT` unset)
 *   - The key does not exist in the store
 *   - The store is unreachable (network / auth error)
 *
 * Results (including null for missing keys) are cached in-process for
 * `APP_CONFIG_SETTING_TTL_SECONDS` seconds (default 60).
 */
export async function getAppConfigSetting(key: string): Promise<string | null> {
  if (!isAppConfigConfigured()) return null;

  const ttlMs = getSettingTtlMs();
  const now = Date.now();

  if (ttlMs > 0) {
    const cached = _settingCache.get(key);
    if (cached !== undefined && now < cached.expiresAt) {
      return cached.value;
    }
  }

  let result: string | null;
  try {
    const response = await getClient().getConfigurationSetting({ key });
    result = response.value ?? null;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "FeatureNotFound" || code === "ConfigurationSettingNotFound") {
      result = null;
    } else {
      logger.warn({ err, key }, "App Configuration read failed — using local fallback");
      return null;
    }
  }

  if (ttlMs > 0) {
    _settingCache.set(key, { value: result, expiresAt: now + ttlMs });
  }

  return result;
}

/**
 * Reads a feature flag from Azure App Configuration.
 *
 * Feature flags are stored with key `.appconfig.featureflag/<flagName>` and
 * a JSON body `{ "id": "...", "enabled": true|false, ... }`.
 *
 * Returns:
 *   - `true`  — flag is enabled (or absent, or store unreachable, or App
 *               Configuration not configured). The safe default keeps every
 *               surface visible in dev/mock mode.
 *   - `false` — flag exists in the store with `"enabled": false`.
 */
export async function getAppConfigFeatureFlag(flagName: string): Promise<boolean> {
  if (!isAppConfigConfigured()) return true;

  const ttlMs = getFlagTtlMs();
  const now = Date.now();

  if (ttlMs > 0) {
    const cached = _flagCache.get(flagName);
    if (cached !== undefined && now < cached.expiresAt) {
      return cached.value;
    }
  }

  const key = `.appconfig.featureflag/${flagName}`;
  let result: boolean;
  try {
    const response = await getClient().getConfigurationSetting({ key });
    if (!response.value) {
      result = true;
    } else {
      const parsed = JSON.parse(response.value) as { enabled?: boolean };
      result = parsed.enabled !== false;
    }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "FeatureNotFound" || code === "ConfigurationSettingNotFound") {
      result = true;
    } else {
      logger.warn({ err, flagName }, "App Configuration feature flag read failed — defaulting to enabled");
      result = true;
    }
  }

  if (ttlMs > 0) {
    _flagCache.set(flagName, { value: result, expiresAt: now + ttlMs });
  }

  return result;
}
