import { Router, type IRouter } from "express";
import * as client from "openid-client";
import { getEntraConfig, getOidcConfiguration } from "../lib/entra";
import { resolveOrbitGroups } from "../lib/orbitGroups";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEFAULT_ACCESS_CONTACT = "orbit-access@kinisislabs.com";

/** Contact address for access-request emails. Configurable via ORBIT_ACCESS_CONTACT env var. */
function getAccessContact(): string {
  const v = process.env.ORBIT_ACCESS_CONTACT?.trim();
  return v && v.length > 0 ? v : DEFAULT_ACCESS_CONTACT;
}

/**
 * Fetches all group object IDs the signed-in user belongs to via the Microsoft
 * Graph /me/memberOf endpoint. Used as a fallback when the ID token contains
 * the `_claim_names.groups` overage marker (user is a member of more groups
 * than the token can carry — roughly 200+).
 *
 * The access token must have been issued with the
 * `https://graph.microsoft.com/User.Read` delegated scope so that its audience
 * is `https://graph.microsoft.com`; otherwise Graph will reject it with 401.
 *
 * /memberOf returns pages of directory objects (groups, roles, admin units…).
 * We extract only the `id` field and follow @odata.nextLink until exhausted.
 */
async function fetchGraphGroupIds(accessToken: string): Promise<string[]> {
  const groupIds: string[] = [];
  // $select=id reduces payload; $top=999 is within Graph's supported max
  let url: string | null =
    "https://graph.microsoft.com/v1.0/me/memberOf?$select=id&$top=999";

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      throw new Error(
        `Graph /me/memberOf responded ${resp.status}: ${body}`,
      );
    }
    const data = (await resp.json()) as {
      value?: Array<{ id?: string }>;
      "@odata.nextLink"?: string;
    };
    for (const item of data.value ?? []) {
      if (typeof item.id === "string") groupIds.push(item.id);
    }
    url = data["@odata.nextLink"] ?? null;
  }

  return groupIds;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/**
 * Only allow same-origin relative paths as a post-login redirect target.
 * Rejects absolute URLs and protocol-relative ("//host") / backslash tricks
 * to prevent open redirects.
 */
function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/")) return "/";
  if (v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v;
}

/**
 * How often (in ms) to re-check group membership from Graph while the session
 * is active. Defaults to 60 minutes; override with GROUP_CHECK_INTERVAL_MINUTES.
 */
function groupCheckIntervalMs(): number {
  const raw = process.env.GROUP_CHECK_INTERVAL_MINUTES;
  const minutes = raw ? parseFloat(raw) : 60;
  return (isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
}

/** Seconds before token expiry at which we proactively refresh it. */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns a valid Graph access token, silently renewing it via the refresh
 * token if the current one is at or near expiry.
 *
 * Throws when renewal fails (refresh token expired, revoked, network error).
 * The caller should treat a thrown error as a signal to force re-authentication.
 */
async function ensureFreshAccessToken(
  u: { accessToken?: string; tokenExpiresAt?: number; refreshToken?: string },
  oidcConfig: client.Configuration,
): Promise<{ accessToken: string; tokenExpiresAt: number; refreshToken?: string }> {
  const tokenExpiresAt = u.tokenExpiresAt ?? 0;
  const isNearExpiry = Date.now() >= tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;

  if (!isNearExpiry && u.accessToken) {
    // Token is still fresh — use it as-is.
    return {
      accessToken: u.accessToken,
      tokenExpiresAt,
      refreshToken: u.refreshToken,
    };
  }

  if (!u.refreshToken) {
    throw new Error("Access token expired and no refresh token available");
  }

  // Token is expired or near expiry — silently renew using the refresh token.
  const refreshed = await client.refreshTokenGrant(oidcConfig, u.refreshToken);
  const newAccessToken = refreshed.access_token;
  if (!newAccessToken) throw new Error("Token refresh returned no access_token");

  const newExpiresIn = refreshed.expires_in ?? 3600;
  return {
    accessToken: newAccessToken,
    tokenExpiresAt: Date.now() + newExpiresIn * 1000,
    // Entra may or may not rotate the refresh token; keep the new one if provided.
    refreshToken: refreshed.refresh_token ?? u.refreshToken,
  };
}

/**
 * Current identity. Returns { mode: "mock" } when Entra is not configured (dev),
 * 401 when Entra is configured but there's no session, otherwise the user.
 *
 * When the user's group list is stale (older than GROUP_CHECK_INTERVAL_MINUTES,
 * default 60 min), a live Graph re-check is performed:
 *  - The access token is transparently renewed via the refresh token if it is
 *    near expiry, so re-checks keep working throughout the session lifetime.
 *  - If token renewal fails (refresh token expired/revoked), the session is
 *    destroyed and a 401 is returned — the user must sign in again.
 *  - If the user is no longer in Orbit-Authorized-Users after a fresh Graph
 *    lookup, the session is destroyed and a 401 is returned.
 *  - Otherwise the session's groupIds and derived flags are refreshed so
 *    Access-page badges and FinOps gating stay accurate without a sign-out.
 */
router.get("/auth/me", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    if (!cfg) {
      res.json({ mode: "mock", accessContact: getAccessContact() });
      return;
    }
    const u = req.session.user;
    if (!u) {
      res.status(401).json({ mode: "entra", authenticated: false, accessContact: getAccessContact() });
      return;
    }

    const now = Date.now();
    const lastChecked = u.groupsLastChecked ?? 0;
    const due = now - lastChecked >= groupCheckIntervalMs();

    if (due && u.accessToken) {
      let freshTokens: Awaited<ReturnType<typeof ensureFreshAccessToken>>;
      try {
        const oidcConfig = await getOidcConfiguration(cfg);
        freshTokens = await ensureFreshAccessToken(u, oidcConfig);
      } catch (err) {
        // Refresh token expired, revoked, or network error. Force re-auth
        // rather than serving potentially stale group memberships.
        logger.warn(
          { err, userId: u.id },
          "Token renewal failed during group re-check; forcing re-authentication",
        );
        req.session.destroy(() => {
          res.clearCookie("orbit.sid");
          res.status(401).json({ mode: "entra", authenticated: false });
        });
        return;
      }

      try {
        const freshGroupIds = await fetchGraphGroupIds(freshTokens.accessToken);
        logger.info(
          { count: freshGroupIds.length, userId: u.id },
          "Refreshed group membership from Graph",
        );

        const authorized =
          !cfg.authorizedGroupId ||
          freshGroupIds.includes(cfg.authorizedGroupId);

        if (!authorized) {
          logger.warn(
            { userId: u.id },
            "User no longer in Orbit-Authorized-Users; destroying session",
          );
          req.session.destroy(() => {
            res.clearCookie("orbit.sid");
            res.status(401).json({ mode: "entra", authenticated: false });
          });
          return;
        }

        req.session.user = {
          ...u,
          groupIds: freshGroupIds,
          isCostReader:
            !!cfg.costReaderGroupId &&
            freshGroupIds.includes(cfg.costReaderGroupId),
          isAdmin:
            !!cfg.adminGroupId && freshGroupIds.includes(cfg.adminGroupId),
          isEngineer:
            !!cfg.engineerGroupId &&
            freshGroupIds.includes(cfg.engineerGroupId),
          accessToken: freshTokens.accessToken,
          tokenExpiresAt: freshTokens.tokenExpiresAt,
          refreshToken: freshTokens.refreshToken,
          groupsLastChecked: now,
        };
        await new Promise<void>((resolve) => req.session.save(() => resolve()));
        const groups = resolveOrbitGroups(cfg, freshGroupIds);
        res.json({
          mode: "entra",
          authenticated: true,
          user: {
            id: u.id,
            displayName: u.displayName,
            userPrincipalName: u.userPrincipalName,
            jobTitle: u.jobTitle,
            initial: (u.displayName?.[0] ?? "?").toUpperCase(),
          },
          groups,
          accessContact: getAccessContact(),
        });
        return;
      } catch (err) {
        // Graph call failed for a transient reason (e.g. network blip).
        // Log and fall through to serve cached membership rather than
        // erroring out — the next due re-check will retry.
        logger.warn(
          { err, userId: u.id },
          "Graph group re-check failed; serving cached membership",
        );
        // Persist the refreshed tokens even if the Graph call failed, so we
        // don't throw away a perfectly good new access token.
        if (
          freshTokens.accessToken !== u.accessToken ||
          freshTokens.tokenExpiresAt !== u.tokenExpiresAt
        ) {
          req.session.user = {
            ...u,
            accessToken: freshTokens.accessToken,
            tokenExpiresAt: freshTokens.tokenExpiresAt,
            refreshToken: freshTokens.refreshToken,
          };
          req.session.save(() => {/* fire-and-forget */});
        }
      }
    }

    const groups = resolveOrbitGroups(cfg, u.groupIds);
    res.json({
      mode: "entra",
      authenticated: true,
      user: {
        id: u.id,
        displayName: u.displayName,
        userPrincipalName: u.userPrincipalName,
        jobTitle: u.jobTitle,
        initial: (u.displayName?.[0] ?? "?").toUpperCase(),
      },
      groups,
      accessContact: getAccessContact(),
    });
  } catch (err) {
    next(err);
  }
});

/** Begin the OIDC authorization-code + PKCE flow. */
router.get("/auth/login", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    if (!cfg) {
      res.status(503).json({ error: "entra_not_configured" });
      return;
    }
    const config = await getOidcConfiguration(cfg);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const returnTo = safeReturnTo(req.query.returnTo);
    req.session.oidc = { codeVerifier, state, nonce, returnTo };

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: cfg.redirectUri,
      scope: cfg.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    res.redirect(authUrl.href);
  } catch (err) {
    next(err);
  }
});

/** OIDC redirect handler: validate the response and establish the session. */
router.get("/auth/callback", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    if (!cfg) {
      res.status(503).json({ error: "entra_not_configured" });
      return;
    }
    const oidc = req.session.oidc;
    if (!oidc) {
      res.redirect("/?auth=expired");
      return;
    }
    const config = await getOidcConfiguration(cfg);
    const currentUrl = new URL(cfg.redirectUri);
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") currentUrl.searchParams.set(k, v);
    }

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: oidc.codeVerifier,
      expectedState: oidc.state,
      expectedNonce: oidc.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) {
      res.redirect("/?auth=error");
      return;
    }

    let groupIds = Array.isArray(claims.groups)
      ? claims.groups.filter((g): g is string => typeof g === "string")
      : [];
    const claimNames = claims._claim_names;
    if (
      groupIds.length === 0 &&
      claimNames &&
      typeof claimNames === "object" &&
      "groups" in claimNames
    ) {
      // Groups "overage": the user is a member of more groups than the token
      // can carry (~200+ groups). Fall back to the Microsoft Graph /memberOf
      // API using the access token acquired in the same OIDC exchange.
      // Requires the https://graph.microsoft.com/User.Read scope (included in
      // the default ENTRA_SCOPES) so the access token has a Graph audience.
      logger.warn(
        "Entra groups claim overage detected; fetching group list from Graph",
      );
      try {
        const accessToken = tokens.access_token;
        if (!accessToken) throw new Error("No access token in token response");
        groupIds = await fetchGraphGroupIds(accessToken);
        logger.info(
          { count: groupIds.length },
          "Graph /memberOf returned groups for overage user",
        );
      } catch (err) {
        logger.error(
          { err },
          "Failed to fetch groups from Graph; user will have no group memberships",
        );
      }
    }

    const authorized =
      !cfg.authorizedGroupId || groupIds.includes(cfg.authorizedGroupId);
    if (!authorized) {
      delete req.session.oidc;
      res.redirect("/?auth=denied");
      return;
    }

    const displayName =
      str(claims.name) ?? str(claims.preferred_username) ?? "Kinisis Staff";
    req.session.user = {
      id: str(claims.oid) ?? claims.sub,
      displayName,
      userPrincipalName: str(claims.preferred_username) ?? "",
      jobTitle: str(claims.jobTitle) ?? "",
      groupIds,
      isCostReader:
        !!cfg.costReaderGroupId && groupIds.includes(cfg.costReaderGroupId),
      isAdmin: !!cfg.adminGroupId && groupIds.includes(cfg.adminGroupId),
      isEngineer:
        !!cfg.engineerGroupId && groupIds.includes(cfg.engineerGroupId),
      accessToken: tokens.access_token,
      tokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      refreshToken: tokens.refresh_token,
      groupsLastChecked: Date.now(),
    };
    const returnTo = safeReturnTo(oidc.returnTo);
    delete req.session.oidc;
    req.session.save(() => res.redirect(returnTo));
  } catch (err) {
    next(err);
  }
});

/** Destroy the session and return where the client should navigate next. */
router.post("/auth/logout", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    req.session.destroy(() => {
      res.clearCookie("orbit.sid");
      void (async () => {
        if (cfg?.postLogoutRedirectUri) {
          try {
            const config = await getOidcConfiguration(cfg);
            const url = client.buildEndSessionUrl(config, {
              post_logout_redirect_uri: cfg.postLogoutRedirectUri,
            });
            res.json({ redirect: url.href });
            return;
          } catch {
            /* fall through to default redirect */
          }
        }
        res.json({ redirect: "/" });
      })();
    });
  } catch (err) {
    next(err);
  }
});

export default router;
