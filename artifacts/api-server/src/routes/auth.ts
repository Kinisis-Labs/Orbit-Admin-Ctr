import { Router, type IRouter } from "express";
import * as client from "openid-client";
import { getEntraConfig, getOidcConfiguration } from "../lib/entra";
import { resolveOrbitGroups } from "../lib/orbitGroups";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
 * Current identity. Returns { mode: "mock" } when Entra is not configured (dev),
 * 401 when Entra is configured but there's no session, otherwise the user.
 */
router.get("/auth/me", (req, res) => {
  const cfg = getEntraConfig();
  if (!cfg) {
    res.json({ mode: "mock" });
    return;
  }
  const u = req.session.user;
  if (!u) {
    res.status(401).json({ mode: "entra", authenticated: false });
    return;
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
  });
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

    const groupIds = Array.isArray(claims.groups)
      ? claims.groups.filter((g): g is string => typeof g === "string")
      : [];
    const claimNames = claims._claim_names;
    if (
      groupIds.length === 0 &&
      claimNames &&
      typeof claimNames === "object" &&
      "groups" in claimNames
    ) {
      // Groups "overage": the user is in too many groups for the token to carry
      // the claim. Group-based gating needs a Microsoft Graph fallback (or app
      // roles) — deferred. Treat as no special groups for now.
      logger.warn(
        "Entra groups claim overage; group-based gating may be incomplete",
      );
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
