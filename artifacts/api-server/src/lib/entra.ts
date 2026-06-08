import * as client from "openid-client";

/**
 * Microsoft Entra ID (Azure AD) OIDC configuration, read from the environment.
 *
 * Auth is only "real" when the required vars are present; otherwise the app runs
 * in mock mode (see `isEntraConfigured`) so the Replit dev preview keeps working
 * without an Entra tenant. In production (Azure) these are set on the Container
 * App and sign-in goes through the corporate Entra tenant.
 */
export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  /** Group object IDs (GUIDs) used for access gating, from the `groups` claim. */
  authorizedGroupId?: string;
  adminGroupId?: string;
  engineerGroupId?: string;
  costReaderGroupId?: string;
  finopsGroupId?: string;
  scopes: string;
}

export function getEntraConfig(): EntraConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    postLogoutRedirectUri: process.env.ENTRA_POST_LOGOUT_REDIRECT_URI,
    authorizedGroupId: process.env.ENTRA_AUTHORIZED_GROUP_ID,
    adminGroupId: process.env.ENTRA_ADMIN_GROUP_ID,
    engineerGroupId: process.env.ENTRA_ENGINEER_GROUP_ID,
    costReaderGroupId: process.env.ENTRA_COST_READER_GROUP_ID,
    finopsGroupId: process.env.ENTRA_FINOPS_GROUP_ID,
    // offline_access is required so Entra issues a refresh token; without it
    // the delegated access token cannot be silently renewed and group re-checks
    // will fail after the initial token expires (~60-90 min).
    scopes:
      process.env.ENTRA_SCOPES ??
      "openid profile email offline_access https://graph.microsoft.com/User.Read",
  };
}

export function isEntraConfigured(): boolean {
  return getEntraConfig() !== null;
}

let configPromise: Promise<client.Configuration> | null = null;

/** Lazily discover + cache the Entra OIDC configuration. */
export function getOidcConfiguration(
  cfg: EntraConfig,
): Promise<client.Configuration> {
  if (!configPromise) {
    const issuer = new URL(
      `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
    );
    configPromise = client
      .discovery(issuer, cfg.clientId, cfg.clientSecret)
      .catch((err: unknown) => {
        // Reset so a later request can retry discovery after a transient error.
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}
