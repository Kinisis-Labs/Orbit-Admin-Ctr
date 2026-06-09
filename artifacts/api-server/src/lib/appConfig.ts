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
 */

import { AppConfigurationClient } from "@azure/app-configuration";
import { getAzureCredential } from "./azure.js";
import { logger } from "./logger.js";

let _client: AppConfigurationClient | null = null;

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
 */
export async function getAppConfigSetting(key: string): Promise<string | null> {
  if (!isAppConfigConfigured()) return null;
  try {
    const response = await getClient().getConfigurationSetting({ key });
    return response.value ?? null;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "FeatureNotFound" || code === "ConfigurationSettingNotFound") {
      return null;
    }
    logger.warn({ err, key }, "App Configuration read failed — using local fallback");
    return null;
  }
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
  const key = `.appconfig.featureflag/${flagName}`;
  try {
    const response = await getClient().getConfigurationSetting({ key });
    if (!response.value) return true;
    const parsed = JSON.parse(response.value) as { enabled?: boolean };
    return parsed.enabled !== false;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "FeatureNotFound" || code === "ConfigurationSettingNotFound") {
      return true;
    }
    logger.warn({ err, flagName }, "App Configuration feature flag read failed — defaulting to enabled");
    return true;
  }
}
