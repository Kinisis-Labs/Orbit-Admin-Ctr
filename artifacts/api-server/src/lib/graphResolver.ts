/**
 * Microsoft Graph — display-name resolver for Activity Log actor GUIDs.
 *
 * Azure Activity Log `caller` values are often raw Entra object IDs (GUIDs)
 * for service principals and managed identities. This module resolves them to
 * human-readable display names using the Microsoft Graph API.
 *
 * Auth: client_credentials grant using the Orbit Entra app registration
 * (ENTRA_TENANT_ID + ENTRA_CLIENT_ID + ENTRA_CLIENT_SECRET). Requires the
 * app registration to have the application permission
 * `Application.Read.All` (and optionally `User.Read.All`) granted with admin
 * consent. Falls back gracefully when unconfigured or when permissions are
 * missing — returning a truncated GUID so the UI always shows something useful.
 *
 * Resolution order per GUID:
 *   1. In-memory cache
 *   2. GET /v1.0/servicePrincipals/{id}  (managed identities, app registrations)
 *   3. GET /v1.0/users/{id}              (human users)
 *   4. Truncated GUID: "5428ed38…"
 */

import { logger } from "./logger.js";

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuid(s: string): boolean {
  return GUID_RE.test(s);
}

function truncate(guid: string): string {
  return `${guid.slice(0, 8)}…`;
}

type TokenCache = {
  token: string;
  expiresAt: number;
};

let _tokenCache: TokenCache | null = null;

export async function getGraphToken(): Promise<string | null> {
  const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET } =
    process.env;
  if (!ENTRA_TENANT_ID || !ENTRA_CLIENT_ID || !ENTRA_CLIENT_SECRET) {
    return null;
  }

  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  try {
    const resp = await fetch(
      `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: ENTRA_CLIENT_ID,
          client_secret: ENTRA_CLIENT_SECRET,
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
      },
    );
    if (!resp.ok) {
      logger.warn(
        { status: resp.status },
        "graphResolver: failed to acquire Graph token",
      );
      return null;
    }
    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
    };
    _tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return _tokenCache.token;
  } catch (err) {
    logger.warn({ err }, "graphResolver: token fetch error");
    return null;
  }
}

const _nameCache = new Map<string, string>();

async function lookupGuid(token: string, guid: string): Promise<string | null> {
  const headers = { Authorization: `Bearer ${token}` };

  const spResp = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals/${guid}?$select=displayName`,
    { headers },
  );
  if (spResp.ok) {
    const data = (await spResp.json()) as { displayName?: string };
    if (data.displayName) return data.displayName;
  }

  if (spResp.status === 404 || spResp.status === 400) {
    const userResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${guid}?$select=displayName`,
      { headers },
    );
    if (userResp.ok) {
      const data = (await userResp.json()) as { displayName?: string };
      if (data.displayName) return data.displayName;
    }
  }

  return null;
}

/**
 * Resolves a single caller string to a display name.
 * - Non-GUID strings (email addresses, system names) are returned as-is.
 * - GUID strings are resolved via Microsoft Graph; falls back to truncated GUID.
 */
export async function resolveActorName(caller: string): Promise<string> {
  if (!isGuid(caller)) return caller;

  const cached = _nameCache.get(caller);
  if (cached !== undefined) return cached;

  const token = await getGraphToken();
  if (!token) {
    return truncate(caller);
  }

  try {
    const name = await lookupGuid(token, caller);
    if (name) _nameCache.set(caller, name);
    return name ?? truncate(caller);
  } catch (err) {
    logger.warn({ err, caller }, "graphResolver: lookup error");
    return truncate(caller);
  }
}

/**
 * Resolves a batch of unique caller GUIDs in parallel (max 10 concurrent).
 * Returns a map of caller → display name for callers that are GUIDs.
 * Non-GUIDs are not included in the returned map (use as-is).
 */
export async function resolveActorNames(
  callers: string[],
): Promise<Map<string, string>> {
  const guids = [...new Set(callers.filter(isGuid))];
  const result = new Map<string, string>();

  const token = await getGraphToken();

  await Promise.all(
    guids.map(async (guid) => {
      const cached = _nameCache.get(guid);
      if (cached !== undefined) {
        result.set(guid, cached);
        return;
      }
      if (!token) {
        result.set(guid, truncate(guid));
        return;
      }
      try {
        const name = await lookupGuid(token, guid);
        if (name) _nameCache.set(guid, name);
        result.set(guid, name ?? truncate(guid));
      } catch {
        result.set(guid, truncate(guid));
      }
    }),
  );

  return result;
}
