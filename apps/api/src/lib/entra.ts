import * as client from "openid-client";

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
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
    scopes:
      process.env.ENTRA_SCOPES ??
      "openid profile email offline_access https://graph.microsoft.com/User.Read",
  };
}

export function isEntraConfigured(): boolean {
  return getEntraConfig() !== null;
}

let configPromise: Promise<client.Configuration> | null = null;

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
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}
