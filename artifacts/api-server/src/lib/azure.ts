import { DefaultAzureCredential } from "@azure/identity";

/**
 * Azure SDK credential + configuration gate.
 *
 * Real Azure calls are only made when:
 *   - AZURE_SUBSCRIPTION_IDS is set (comma-separated list)
 *   - AZURE_CLIENT_ID and AZURE_TENANT_ID are set (managed identity / env creds)
 *
 * When those vars are absent the app runs in mock mode (Replit dev preview).
 * In production on Azure Container Apps, DefaultAzureCredential automatically
 * picks up the user-assigned managed identity `id-orbit-api-prod`.
 */

let _credential: DefaultAzureCredential | null = null;

export function getAzureCredential(): DefaultAzureCredential {
  if (!_credential) {
    _credential = new DefaultAzureCredential();
  }
  return _credential;
}

/** Subscription IDs to query, parsed from AZURE_SUBSCRIPTION_IDS. */
export function getSubscriptionIds(): string[] {
  const raw = process.env.AZURE_SUBSCRIPTION_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns true when the required Azure env vars are present.
 *
 * Only AZURE_SUBSCRIPTION_IDS is strictly required — in production on Azure
 * Container Apps, DefaultAzureCredential picks up the user-assigned managed
 * identity `id-orbit-api-prod` automatically via IMDS (no explicit client/
 * tenant IDs needed at runtime). Setting AZURE_CLIENT_ID to the managed
 * identity's client ID is still recommended so DefaultAzureCredential doesn't
 * have to guess when multiple identities are assigned.
 */
export function isAzureConfigured(): boolean {
  return Boolean(process.env.AZURE_SUBSCRIPTION_IDS);
}
