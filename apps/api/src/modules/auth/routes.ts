import { Router, type IRouter } from "express";
import * as client from "openid-client";
import { getEntraConfig, getOidcConfiguration } from "../../lib/entra.js";
import { resolveOrbitGroups } from "../../lib/orbitGroups.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const DEFAULT_ACCESS_CONTACT = "support@kinisislabs.com";

function getAccessContact(): string {
  const v = process.env.ORBIT_ACCESS_CONTACT?.trim();
  return v && v.length > 0 ? v : DEFAULT_ACCESS_CONTACT;
}

async function fetchGraphGroupIds(accessToken: string): Promise<string[]> {
  const groupIds: string[] = [];
  let url: string | null =
    "https://graph.microsoft.com/v1.0/me/memberOf?$select=id&$top=999";

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      throw new Error(`Graph /me/memberOf responded ${resp.status}: ${body}`);
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

function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/")) return "/";
  if (v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v;
}

function groupCheckIntervalMs(): number {
  const raw = process.env.GROUP_CHECK_INTERVAL_MINUTES;
  const minutes = raw ? parseFloat(raw) : 60;
  return (isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function ensureFreshAccessToken(
  u: { accessToken?: string; tokenExpiresAt?: number; refreshToken?: string },
  oidcConfig: client.Configuration,
): Promise<{ accessToken: string; tokenExpiresAt: number; refreshToken?: string }> {
  const tokenExpiresAt = u.tokenExpiresAt ?? 0;
  const isNearExpiry = Date.now() >= tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;

  if (!isNearExpiry && u.accessToken) {
    return { accessToken: u.accessToken, tokenExpiresAt, refreshToken: u.refreshToken };
  }

  if (!u.refreshToken) {
    throw new Error("Access token expired and no refresh token available");
  }

  const refreshed = await client.refreshTokenGrant(oidcConfig, u.refreshToken);
  const newAccessToken = refreshed.access_token;
  if (!newAccessToken) throw new Error("Token refresh returned no access_token");

  const newExpiresIn = refreshed.expires_in ?? 3600;
  return {
    accessToken: newAccessToken,
    tokenExpiresAt: Date.now() + newExpiresIn * 1000,
    refreshToken: refreshed.refresh_token ?? u.refreshToken,
  };
}

router.get("/auth/me", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    if (!cfg) {
      res.status(503).json({ error: "Entra ID is not configured" });
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
        logger.warn({ err, userId: u.id }, "Token renewal failed during group re-check; forcing re-authentication");
        req.session.destroy(() => {
          res.clearCookie("orbit.sid");
          res.status(401).json({ mode: "entra", authenticated: false });
        });
        return;
      }

      try {
        const freshGroupIds = await fetchGraphGroupIds(freshTokens.accessToken);
        logger.info({ count: freshGroupIds.length, userId: u.id }, "Refreshed group membership from Graph");

        const authorized = !cfg.authorizedGroupId || freshGroupIds.includes(cfg.authorizedGroupId);
        if (!authorized) {
          logger.warn({ userId: u.id }, "User no longer in Orbit-Authorized-Users; destroying session");
          req.session.destroy(() => {
            res.clearCookie("orbit.sid");
            res.status(401).json({ mode: "entra", authenticated: false });
          });
          return;
        }

        req.session.user = {
          ...u,
          groupIds: freshGroupIds,
          isCostReader: !!cfg.costReaderGroupId && freshGroupIds.includes(cfg.costReaderGroupId),
          isAdmin: !!cfg.adminGroupId && freshGroupIds.includes(cfg.adminGroupId),
          isEngineer: !!cfg.engineerGroupId && freshGroupIds.includes(cfg.engineerGroupId),
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
            isAdmin: u.isAdmin,
            isEngineer: u.isEngineer,
          },
          groups,
          accessContact: getAccessContact(),
        });
        return;
      } catch (err) {
        logger.warn({ err, userId: u.id }, "Graph group re-check failed; serving cached membership");
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
          req.session.save(() => { /* fire-and-forget */ });
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
        isAdmin: u.isAdmin,
        isEngineer: u.isEngineer,
      },
      groups,
      accessContact: getAccessContact(),
    });
  } catch (err) {
    next(err);
  }
});

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
      logger.warn("Entra groups claim overage detected; fetching group list from Graph");
      try {
        const accessToken = tokens.access_token;
        if (!accessToken) throw new Error("No access token in token response");
        groupIds = await fetchGraphGroupIds(accessToken);
        logger.info({ count: groupIds.length }, "Graph /memberOf returned groups for overage user");
      } catch (err) {
        logger.error({ err }, "Failed to fetch groups from Graph; user will have no group memberships");
      }
    }

    const authorized = !cfg.authorizedGroupId || groupIds.includes(cfg.authorizedGroupId);
    if (!authorized) {
      delete req.session.oidc;
      res.redirect("/?auth=denied");
      return;
    }

    const displayName = str(claims.name) ?? str(claims.preferred_username) ?? "Kinisis Staff";
    req.session.user = {
      id: str(claims.oid) ?? claims.sub,
      displayName,
      userPrincipalName: str(claims.preferred_username) ?? "",
      jobTitle: str(claims.jobTitle) ?? "",
      groupIds,
      isCostReader: !!cfg.costReaderGroupId && groupIds.includes(cfg.costReaderGroupId),
      isAdmin: !!cfg.adminGroupId && groupIds.includes(cfg.adminGroupId),
      isEngineer: !!cfg.engineerGroupId && groupIds.includes(cfg.engineerGroupId),
      accessToken: tokens.access_token,
      tokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      groupsLastChecked: Date.now(),
    };
    const returnTo = safeReturnTo(oidc.returnTo);
    delete req.session.oidc;
    req.session.save(() => res.redirect(returnTo));
  } catch (err) {
    next(err);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const cfg = getEntraConfig();
    const idToken = req.session.user?.idToken;
    const upn = req.session.user?.userPrincipalName;
    req.session.destroy(() => {
      res.clearCookie("orbit.sid");
      void (async () => {
        if (cfg) {
          try {
            const config = await getOidcConfiguration(cfg);
            const url = client.buildEndSessionUrl(config, {
              ...(cfg.postLogoutRedirectUri
                ? { post_logout_redirect_uri: cfg.postLogoutRedirectUri }
                : {}),
              ...(idToken ? { id_token_hint: idToken } : upn ? { logout_hint: upn } : {}),
            });
            res.json({ redirect: url.href });
            return;
          } catch {
            /* fall through to default redirect */
          }
        }
        res.json({ redirect: "/signed-out" });
      })();
    });
  } catch (err) {
    next(err);
  }
});

export default router;
