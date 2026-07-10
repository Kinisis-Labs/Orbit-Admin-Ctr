/**
 * Microsoft Graph API client.
 *
 * Production: uses Managed Identity (IDENTITY_ENDPOINT + IDENTITY_HEADER).
 * Local dev fallback: reads AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.
 *
 * Requires Graph permissions: AuditLog.Read.All, SignIn.Read.All (admin-consented).
 */

export interface SignInEvent {
  id: string;
  createdDateTime: string;
  userDisplayName: string;
  userPrincipalName: string;
  ipAddress: string;
  status: { errorCode: number; failureReason?: string };
  conditionalAccessStatus: string;
  isInteractive: boolean;
}

export interface GraphSecuritySummary {
  recentSignIns: SignInEvent[];
  failedSignIns: SignInEvent[];
  mfaFailureCount: number;
  totalSignIns24h: number;
  capturedAt: string;
  graphConfigured: boolean;
}

// ── Token acquisition ────────────────────────────────────────────────────────

async function getGraphToken(): Promise<string | null> {
  try {
    const miEndpoint = process.env.IDENTITY_ENDPOINT;
    const miHeader = process.env.IDENTITY_HEADER;

    if (miEndpoint && miHeader) {
      const res = await fetch(
        `${miEndpoint}?resource=https://graph.microsoft.com&api-version=2019-08-01`,
        { headers: { "X-IDENTITY-HEADER": miHeader } },
      );
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (tenantId && clientId && clientSecret) {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      });
      const res = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        { method: "POST", body },
      );
      if (res.ok) {
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isGraphConfigured(): boolean {
  const hasMI = !!(process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER);
  const hasCreds = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET
  );
  return hasMI || hasCreds;
}

// ── Graph query helpers ──────────────────────────────────────────────────────

async function graphGet<T>(token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Sign-in log queries ──────────────────────────────────────────────────────

export async function getSecuritySummary(): Promise<GraphSecuritySummary> {
  const capturedAt = new Date().toISOString();
  const empty: GraphSecuritySummary = {
    recentSignIns: [],
    failedSignIns: [],
    mfaFailureCount: 0,
    totalSignIns24h: 0,
    capturedAt,
    graphConfigured: isGraphConfigured(),
  };

  const token = await getGraphToken();
  if (!token) return empty;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  type SignInResponse = { value?: SignInEvent[] };

  const [recentRes, failedRes, mfaRes] = await Promise.all([
    graphGet<SignInResponse>(
      token,
      `/auditLogs/signIns?$top=25&$orderby=createdDateTime desc&$filter=createdDateTime ge ${since}`,
    ),
    graphGet<SignInResponse>(
      token,
      `/auditLogs/signIns?$top=25&$orderby=createdDateTime desc&$filter=createdDateTime ge ${since} and status/errorCode ne 0`,
    ),
    graphGet<SignInResponse>(
      token,
      `/auditLogs/signIns?$top=1&$filter=createdDateTime ge ${since} and status/errorCode eq 500121`,
    ),
  ]);

  const recentSignIns = recentRes?.value ?? [];
  const failedSignIns = failedRes?.value ?? [];
  const mfaFailureCount = mfaRes?.value?.length ?? 0;

  return {
    recentSignIns,
    failedSignIns,
    mfaFailureCount,
    totalSignIns24h: recentSignIns.length,
    capturedAt,
    graphConfigured: true,
  };
}
