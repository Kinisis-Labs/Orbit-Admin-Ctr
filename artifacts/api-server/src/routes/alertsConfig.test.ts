/**
 * Route-level integration tests for alertsConfig routes.
 *
 * Confirms the auth middleware chain is enforced end-to-end:
 *   - unauthenticated → 401  (requireAuth applied at routes/index level)
 *   - authenticated non-admin → 403  (requireAdmin on PUT route)
 *   - authenticated admin → 200
 *
 * Uses a real Express app with a mock session injector so no
 * express-session / Postgres session store is needed for the test harness.
 * Entra env vars are set before each suite to force auth enforcement.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import alertsConfigRouter from "./alertsConfig.js";
import { requireAuth } from "../middlewares/auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SessionUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  groupIds: string[];
  isCostReader: boolean;
  isAdmin: boolean;
  isEngineer: boolean;
};

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

/**
 * Build a minimal Express app that mounts the alertsConfig router behind
 * requireAuth, with a lightweight session injector so no DB-backed
 * express-session is needed.
 */
function makeApp(user: SessionUser | undefined) {
  const app = express();
  app.use(express.json());
  // Inject a fake session — bypasses the DB-backed express-session middleware
  // while still exercising the real requireAuth / requireAdmin middlewares.
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).session = { user };
    next();
  });
  app.use("/api", requireAuth, alertsConfigRouter);
  return app;
}

async function withServer(
  app: ReturnType<typeof express>,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Entra env — force auth enforcement (same trick as auth.test.ts)
// ---------------------------------------------------------------------------

const ENTRA_VARS: Record<string, string> = {
  ENTRA_TENANT_ID: "fake-tenant",
  ENTRA_CLIENT_ID: "fake-client",
  ENTRA_CLIENT_SECRET: "fake-secret",
  ENTRA_REDIRECT_URI: "https://example.com/callback",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("alertsConfig routes — auth enforcement", () => {
  before(() => {
    for (const [k, v] of Object.entries(ENTRA_VARS)) process.env[k] = v;
  });

  after(() => {
    for (const k of Object.keys(ENTRA_VARS)) delete process.env[k];
  });

  // ── GET /api/alerts/config ─────────────────────────────────────────────
  // Read: gated by requireAuth only (any authenticated user may see threshold
  // config summaries).

  describe("GET /api/alerts/config", () => {
    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/alerts/config`);
        assert.equal(res.status, 401, "no session → 401 from requireAuth");
      });
    });

    test("regular (non-admin) user → 200", async () => {
      await withServer(makeApp(makeUser({ isAdmin: false })), async (url) => {
        const res = await fetch(`${url}/api/alerts/config`);
        assert.equal(
          res.status,
          200,
          "requireAuth only; any authenticated user may read",
        );
      });
    });

    test("admin user → 200", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/alerts/config`);
        assert.equal(res.status, 200);
      });
    });
  });

  // ── GET /api/alerts/channels ───────────────────────────────────────────
  // Informational: requireAuth only.

  describe("GET /api/alerts/channels", () => {
    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/alerts/channels`);
        assert.equal(res.status, 401);
      });
    });

    test("any authenticated user → 200 with channel status", async () => {
      await withServer(makeApp(makeUser()), async (url) => {
        const res = await fetch(`${url}/api/alerts/channels`);
        assert.equal(res.status, 200);
        const json = (await res.json()) as { teams: boolean; email: boolean };
        assert.ok("teams" in json && "email" in json);
      });
    });
  });

  // ── PUT /api/alerts/config/:appId ─────────────────────────────────────
  // Write: requireAuth (index) + requireAdmin (route).

  describe("PUT /api/alerts/config/:appId (requireAdmin)", () => {
    const body = JSON.stringify({ cpuThresholdPct: 75, memoryThresholdPct: 80 });
    const headers = { "Content-Type": "application/json" };

    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/alerts/config/grailbabe`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 401, "no session → 401 from requireAuth");
      });
    });

    test("authenticated non-admin → 403", async () => {
      await withServer(makeApp(makeUser({ isAdmin: false })), async (url) => {
        const res = await fetch(`${url}/api/alerts/config/grailbabe`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 403, "non-admin → 403 from requireAdmin");
        const json = (await res.json()) as {
          error: string;
          requiredGroup: string;
        };
        assert.equal(json.error, "forbidden");
        assert.ok(
          json.requiredGroup.includes("Orbit-Admins"),
          `expected requiredGroup to mention Orbit-Admins, got: ${json.requiredGroup}`,
        );
      });
    });

    test("engineer (without admin) → 403", async () => {
      await withServer(
        makeApp(makeUser({ isEngineer: true, isAdmin: false })),
        async (url) => {
          const res = await fetch(`${url}/api/alerts/config/grailbabe`, {
            method: "PUT",
            headers,
            body,
          });
          assert.equal(
            res.status,
            403,
            "this route requires admin; engineer alone is insufficient",
          );
        },
      );
    });

    test("admin → 200 with appId echoed in response", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/alerts/config/grailbabe`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 200, "admin passes requireAdmin");
        const json = (await res.json()) as { appId: string; appName: string };
        assert.equal(json.appId, "grailbabe");
        assert.equal(json.appName, "GrailBabe");
      });
    });

    test("admin with unknown appId → 404", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/alerts/config/does-not-exist`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(
          res.status,
          404,
          "auth passes but handler returns 404 for unknown app",
        );
      });
    });
  });

  // ── GET /api/alerts/config/:appId/history ─────────────────────────────
  // Audit log read: requireAuth only.

  describe("GET /api/alerts/config/:appId/history", () => {
    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(
          `${url}/api/alerts/config/grailbabe/history`,
        );
        assert.equal(res.status, 401);
      });
    });

    test("regular user → 200", async () => {
      await withServer(makeApp(makeUser()), async (url) => {
        const res = await fetch(
          `${url}/api/alerts/config/grailbabe/history`,
        );
        assert.equal(res.status, 200);
        const json = (await res.json()) as unknown[];
        assert.ok(Array.isArray(json), "returns an array");
      });
    });

    test("admin → 200", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(
          `${url}/api/alerts/config/grailbabe/history`,
        );
        assert.equal(res.status, 200);
      });
    });
  });
});
