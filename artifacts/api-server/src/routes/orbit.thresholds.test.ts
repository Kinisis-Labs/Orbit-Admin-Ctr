/**
 * Route-level integration tests for orbit threshold routes.
 *
 * Routes tested:
 *   GET  /api/apps/:appId/thresholds      — requireAuth only (read)
 *   PUT  /api/apps/:appId/thresholds      — requireAuth + requireEngineerOrAdmin
 *   GET  /api/apps/:appId/thresholds/log  — requireAuth + requireEngineerOrAdmin
 *
 * Confirms that:
 *   - unauthenticated → 401  (requireAuth at routes/index level)
 *   - non-privileged authenticated → 403  (requireEngineerOrAdmin)
 *   - engineer or admin → 200
 *
 * Uses a real Express app with a mock session injector so no
 * express-session / Postgres session store is needed for the test harness.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import orbitRouter from "./orbit.js";
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
 * Build a minimal Express app mounting the orbit router behind requireAuth,
 * with a lightweight session injector (no DB-backed express-session).
 */
function makeApp(user: SessionUser | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).session = { user };
    next();
  });
  app.use("/api", requireAuth, orbitRouter);
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

const ENTRA_VARS: Record<string, string> = {
  ENTRA_TENANT_ID: "fake-tenant",
  ENTRA_CLIENT_ID: "fake-client",
  ENTRA_CLIENT_SECRET: "fake-secret",
  ENTRA_REDIRECT_URI: "https://example.com/callback",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orbit threshold routes — auth enforcement", () => {
  before(() => {
    for (const [k, v] of Object.entries(ENTRA_VARS)) process.env[k] = v;
  });

  after(() => {
    for (const k of Object.keys(ENTRA_VARS)) delete process.env[k];
  });

  // ── GET /api/apps/:appId/thresholds ─────────────────────────────────────
  // Read-only: requireAuth only, no role gate.

  describe("GET /api/apps/:appId/thresholds (requireAuth only)", () => {
    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`);
        assert.equal(res.status, 401, "no session → 401 from requireAuth");
      });
    });

    test("regular (non-privileged) user → 200", async () => {
      await withServer(makeApp(makeUser()), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`);
        assert.equal(
          res.status,
          200,
          "any authenticated user may read thresholds",
        );
        const json = (await res.json()) as { appId: string };
        assert.equal(json.appId, "grailbabe");
      });
    });

    test("admin → 200", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`);
        assert.equal(res.status, 200);
      });
    });
  });

  // ── PUT /api/apps/:appId/thresholds ─────────────────────────────────────
  // Write: requireAuth + requireEngineerOrAdmin.

  describe("PUT /api/apps/:appId/thresholds (requireEngineerOrAdmin)", () => {
    const body = JSON.stringify({ cpuThreshold: 75, memoryThreshold: 80 });
    const headers = { "Content-Type": "application/json" };

    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 401, "no session → 401 from requireAuth");
      });
    });

    test("regular user (non-engineer, non-admin) → 403", async () => {
      await withServer(
        makeApp(makeUser({ isAdmin: false, isEngineer: false })),
        async (url) => {
          const res = await fetch(`${url}/api/apps/grailbabe/thresholds`, {
            method: "PUT",
            headers,
            body,
          });
          assert.equal(
            res.status,
            403,
            "regular user → 403 from requireEngineerOrAdmin",
          );
          const json = (await res.json()) as {
            error: string;
            requiredGroup: string;
          };
          assert.equal(json.error, "forbidden");
          assert.ok(
            json.requiredGroup.includes("Orbit-Admins") ||
              json.requiredGroup.includes("Orbit-Engineers"),
            `unexpected requiredGroup: ${json.requiredGroup}`,
          );
        },
      );
    });

    test("engineer → 200", async () => {
      await withServer(makeApp(makeUser({ isEngineer: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 200, "engineer passes requireEngineerOrAdmin");
        const json = (await res.json()) as { appId: string };
        assert.equal(json.appId, "grailbabe");
      });
    });

    test("admin → 200", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds`, {
          method: "PUT",
          headers,
          body,
        });
        assert.equal(res.status, 200, "admin passes requireEngineerOrAdmin");
        const json = (await res.json()) as { appId: string };
        assert.equal(json.appId, "grailbabe");
      });
    });

    test("admin with unknown appId → 404", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/does-not-exist/thresholds`, {
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

  // ── GET /api/apps/:appId/thresholds/log ─────────────────────────────────
  // Audit log: requireAuth + requireEngineerOrAdmin.

  describe("GET /api/apps/:appId/thresholds/log (requireEngineerOrAdmin)", () => {
    test("unauthenticated → 401", async () => {
      await withServer(makeApp(undefined), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds/log`);
        assert.equal(res.status, 401, "no session → 401 from requireAuth");
      });
    });

    test("regular user → 403", async () => {
      await withServer(
        makeApp(makeUser({ isAdmin: false, isEngineer: false })),
        async (url) => {
          const res = await fetch(
            `${url}/api/apps/grailbabe/thresholds/log`,
          );
          assert.equal(
            res.status,
            403,
            "regular user → 403 from requireEngineerOrAdmin",
          );
        },
      );
    });

    test("engineer → 200 with items array", async () => {
      await withServer(makeApp(makeUser({ isEngineer: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds/log`);
        assert.equal(res.status, 200, "engineer passes requireEngineerOrAdmin");
        const json = (await res.json()) as { items: unknown[]; total: number };
        assert.ok(Array.isArray(json.items));
        assert.equal(typeof json.total, "number");
      });
    });

    test("admin → 200 with items array", async () => {
      await withServer(makeApp(makeUser({ isAdmin: true })), async (url) => {
        const res = await fetch(`${url}/api/apps/grailbabe/thresholds/log`);
        assert.equal(res.status, 200, "admin passes requireEngineerOrAdmin");
        const json = (await res.json()) as { items: unknown[]; total: number };
        assert.ok(Array.isArray(json.items));
        assert.equal(typeof json.total, "number");
      });
    });
  });
});
