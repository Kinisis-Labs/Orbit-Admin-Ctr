/**
 * Azure App Configuration helper.
 *
 * Reads settings from the Azure App Configuration store
 * (`appcs-orbit-prod-eus2`) when `APP_CONFIGURATION_ENDPOINT` is set.
 * Falls back silently when the store is not configured or unreachable.
 *
 * Authentication is via `DefaultAzureCredential` — the same managed identity
 * (`id-orbit-api-prod`) that drives the rest of the Azure integrations.
 *
 * Env:
 *   APP_CONFIGURATION_ENDPOINT — URL of the App Configuration store
 *     (e.g. https://appcs-orbit-prod-eus2.azconfig.io). When absent,
 *     `getAppConfigSetting()` always returns null.
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
