/**
 * costReaderGate.test.ts
 *
 * Two complementary test layers for the cost-reader gate on financial API routes:
 *
 * 1. Source-inspection ("route-wiring") tests — read routes/index.ts and assert that
 *    requireCostReader appears in every financial router mount.  These tests fail
 *    immediately if the gate is accidentally removed from the route definitions.
 *
 * 2. Middleware-chain tests — build a minimal Express app that applies the same
 *    [requireAuth, requireCostReader, stubHandler] chain and fires real HTTP
 *    requests to verify the gate enforces 401/403/200 as expected.  These cover
 *    the middleware behaviour for all three financial endpoints.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { requireAuth, requireCostReader } from "../middlewares/auth.js";
import type { SessionUser } from "../lib/session.js";

// ---------------------------------------------------------------------------
// Env-var helpers (mirrors auth.test.ts)
// ---------------------------------------------------------------------------

const ENTRA_VARS: Record<string, string> = {
  ENTRA_TENANT_ID: "fake-tenant",
  ENTRA_CLIENT_ID: "fake-client",
  ENTRA_CLIENT_SECRET: "fake-secret",
  ENTRA_REDIRECT_URI: "https://example.com/callback",
};

function enableEntra() {
  for (const [k, v] of Object.entries(ENTRA_VARS)) {
    process.env[k] = v;
  }
}

function disableEntra() {
  for (const k of Object.keys(ENTRA_VARS)) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// Session-user factories
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    displayName: "Test User",
    userPrincipalName: "test@kinisislabs.com",
    jobTitle: "Engineer",
    groupIds: [],
    isCostReader: false,
    isAdmin: false,
    isEngineer: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test server builder
//
// We keep a mutable reference to the "current user" so tests can swap it
// between requests without rebuilding the server.
// ---------------------------------------------------------------------------

let currentUser: SessionUser | undefined = undefined;

/** Build a minimal Express app with stub handlers for the financial routes. */
function buildGateApp(): express.Express {
  const app = express();

  // Inject the desired session user before auth middleware runs.
  app.use((req, _res, next) => {
    (req as express.Request).session = { user: currentUser } as express.Request["session"];
    next();
  });

  // Mirror the middleware chain from routes/index.ts for each financial route.
  const stub: express.RequestHandler = (_req, res) => {
    res.json({ ok: true });
  };

  app.get("/api/play/subscriptions", requireAuth, requireCostReader, stub);
  app.get("/api/apple/subscriptions", requireAuth, requireCostReader, stub);
  app.get("/api/budget-alerts/log", requireAuth, requireCostReader, stub);

  return app;
}

// ---------------------------------------------------------------------------
// HTTP helper — fire a GET request to the test server, return status + body.
// ---------------------------------------------------------------------------

function get(server: http.Server, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Mock-mode tests (Entra NOT configured)
//
// When Entra is not configured the app runs in dev/mock mode: requireAuth and
// requireCostReader are no-ops, so all routes must be accessible regardless of
// session state.
// ---------------------------------------------------------------------------

describe("cost-reader gate — mock mode (Entra not configured)", () => {
  let server: http.Server;

  before(() => {
    disableEntra();
    server = http.createServer(buildGateApp());
    return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  });

  after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

  test("GET /api/play/subscriptions returns 200 when there is no session (mock mode)", async () => {
    currentUser = undefined;
    const { status, body } = await get(server, "/api/play/subscriptions");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  });

  test("GET /api/apple/subscriptions returns 200 when there is no session (mock mode)", async () => {
    currentUser = undefined;
    const { status, body } = await get(server, "/api/apple/subscriptions");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  });

  test("GET /api/budget-alerts/log returns 200 when there is no session (mock mode)", async () => {
    currentUser = undefined;
    const { status, body } = await get(server, "/api/budget-alerts/log");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  });
});

// ---------------------------------------------------------------------------
// Entra-mode tests — gate enforcement
//
// With Entra configured the middleware is active. Tests cover:
//   - No session → 401 (requireAuth blocks before cost-reader check)
//   - Authenticated but not cost-reader/admin → 403
//   - isCostReader: true → 200
//   - isAdmin: true → 200 (admin implies cost-reader access)
// ---------------------------------------------------------------------------

describe("cost-reader gate — Entra mode", () => {
  let server: http.Server;

  before(() => {
    enableEntra();
    server = http.createServer(buildGateApp());
    return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  });

  after(() => {
    disableEntra();
    return new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  // --- /api/play/subscriptions ---

  describe("/api/play/subscriptions", () => {
    test("returns 401 when there is no session (unauthenticated)", async () => {
      currentUser = undefined;
      const { status, body } = await get(server, "/api/play/subscriptions");
      assert.equal(status, 401, "unauthenticated request must be rejected with 401");
      assert.deepEqual(body, { error: "unauthorized" });
    });

    test("returns 403 for an authenticated user without cost-reader or admin", async () => {
      currentUser = makeUser({ isCostReader: false, isAdmin: false });
      const { status, body } = await get(server, "/api/play/subscriptions");
      assert.equal(status, 403, "authenticated non-cost-reader must be rejected with 403");
      assert.deepEqual(body, { error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
    });

    test("returns 200 for a user with isCostReader: true", async () => {
      currentUser = makeUser({ isCostReader: true });
      const { status, body } = await get(server, "/api/play/subscriptions");
      assert.equal(status, 200, "cost-reader must be allowed through");
      assert.deepEqual(body, { ok: true });
    });

    test("returns 200 for an admin user (admin implies cost-reader access)", async () => {
      currentUser = makeUser({ isAdmin: true, isCostReader: false });
      const { status, body } = await get(server, "/api/play/subscriptions");
      assert.equal(status, 200, "admin must be allowed through even without explicit cost-reader flag");
      assert.deepEqual(body, { ok: true });
    });
  });

  // --- /api/apple/subscriptions ---

  describe("/api/apple/subscriptions", () => {
    test("returns 401 when there is no session (unauthenticated)", async () => {
      currentUser = undefined;
      const { status, body } = await get(server, "/api/apple/subscriptions");
      assert.equal(status, 401, "unauthenticated request must be rejected with 401");
      assert.deepEqual(body, { error: "unauthorized" });
    });

    test("returns 403 for an authenticated user without cost-reader or admin", async () => {
      currentUser = makeUser({ isCostReader: false, isAdmin: false });
      const { status, body } = await get(server, "/api/apple/subscriptions");
      assert.equal(status, 403, "authenticated non-cost-reader must be rejected with 403");
      assert.deepEqual(body, { error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
    });

    test("returns 200 for a user with isCostReader: true", async () => {
      currentUser = makeUser({ isCostReader: true });
      const { status, body } = await get(server, "/api/apple/subscriptions");
      assert.equal(status, 200, "cost-reader must be allowed through");
      assert.deepEqual(body, { ok: true });
    });

    test("returns 200 for an admin user (admin implies cost-reader access)", async () => {
      currentUser = makeUser({ isAdmin: true, isCostReader: false });
      const { status, body } = await get(server, "/api/apple/subscriptions");
      assert.equal(status, 200, "admin must be allowed through even without explicit cost-reader flag");
      assert.deepEqual(body, { ok: true });
    });
  });

  // --- /api/budget-alerts/log ---

  describe("/api/budget-alerts/log", () => {
    test("returns 401 when there is no session (unauthenticated)", async () => {
      currentUser = undefined;
      const { status, body } = await get(server, "/api/budget-alerts/log");
      assert.equal(status, 401, "unauthenticated request must be rejected with 401");
      assert.deepEqual(body, { error: "unauthorized" });
    });

    test("returns 403 for an authenticated user without cost-reader or admin", async () => {
      currentUser = makeUser({ isCostReader: false, isAdmin: false });
      const { status, body } = await get(server, "/api/budget-alerts/log");
      assert.equal(status, 403, "authenticated non-cost-reader must be rejected with 403");
      assert.deepEqual(body, { error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
    });

    test("returns 200 for a user with isCostReader: true", async () => {
      currentUser = makeUser({ isCostReader: true });
      const { status, body } = await get(server, "/api/budget-alerts/log");
      assert.equal(status, 200, "cost-reader must be allowed through");
      assert.deepEqual(body, { ok: true });
    });

    test("returns 200 for an admin user (admin implies cost-reader access)", async () => {
      currentUser = makeUser({ isAdmin: true, isCostReader: false });
      const { status, body } = await get(server, "/api/budget-alerts/log");
      assert.equal(status, 200, "admin must be allowed through even without explicit cost-reader flag");
      assert.deepEqual(body, { ok: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Route-wiring tests (source inspection)
//
// These tests read the source of routes/index.ts and assert that every
// financial router is mounted behind requireCostReader.  They fail immediately
// if someone removes or reorders the middleware without updating this file.
//
// This complements the middleware-chain tests above: those cover _behaviour_,
// these cover _registration_.  Together they catch both "middleware is broken"
// and "middleware was accidentally removed from the mount" regressions.
// ---------------------------------------------------------------------------

describe("route-wiring: requireCostReader in routes/index.ts", () => {
  const routesIndexPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "index.ts",
  );

  let src: string;

  before(() => {
    src = fs.readFileSync(routesIndexPath, "utf-8");
  });

  test("routes/index.ts mounts playSubscriptionsRouter behind requireCostReader", () => {
    assert.ok(
      src.includes("requireCostReader, playSubscriptionsRouter"),
      "playSubscriptionsRouter must be preceded by requireCostReader in routes/index.ts",
    );
  });

  test("routes/index.ts mounts appleSubscriptionsRouter behind requireCostReader", () => {
    assert.ok(
      src.includes("requireCostReader, appleSubscriptionsRouter"),
      "appleSubscriptionsRouter must be preceded by requireCostReader in routes/index.ts",
    );
  });

  test("routes/index.ts mounts budgetAlertLogRouter behind requireCostReader", () => {
    assert.ok(
      src.includes("requireCostReader, budgetAlertLogRouter"),
      "budgetAlertLogRouter must be preceded by requireCostReader in routes/index.ts",
    );
  });

  test("requireCostReader is imported from the auth middleware in routes/index.ts", () => {
    assert.ok(
      src.includes("requireCostReader"),
      "requireCostReader must be imported and used in routes/index.ts",
    );
    assert.ok(
      src.includes('from "../middlewares/auth"') || src.includes("from \"../middlewares/auth\""),
      "requireCostReader must be imported from the auth middleware module",
    );
  });
});
