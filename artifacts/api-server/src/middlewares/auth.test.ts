import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { requireCostReader, requireAuth, requireAdmin, requireEngineerOrAdmin } from "./auth.js";
import type { SessionUser } from "../lib/session.js";

// ---------------------------------------------------------------------------
// Minimal mock helpers
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

type MockRes = {
  statusCode: number | undefined;
  body: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function makeReq(user?: SessionUser): Partial<Request> {
  return { session: { user } as Request["session"] };
}

// ---------------------------------------------------------------------------
// Helpers that temporarily configure a fake Entra environment so the
// "Entra-mode" branches of each middleware are reachable in unit tests.
//
// isEntraConfigured() checks process.env at call time, so setting/deleting
// the four required env vars is sufficient — no module mocking needed.
// ---------------------------------------------------------------------------

const ENTRA_VARS: Record<string, string> = {
  ENTRA_TENANT_ID: "fake-tenant",
  ENTRA_CLIENT_ID: "fake-client",
  ENTRA_CLIENT_SECRET: "fake-secret",
  ENTRA_REDIRECT_URI: "https://example.com/callback",
};

function withEntra<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(ENTRA_VARS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, orig] of Object.entries(saved)) {
      if (orig === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = orig;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// requireCostReader
// ---------------------------------------------------------------------------

describe("requireCostReader (Entra configured)", () => {
  test("passes (calls next) when session user has isAdmin: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireCostReader(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled, "next() should be called for an admin user");
      assert.equal(res.statusCode, undefined, "no status should be set when next() is called");
    });
  });

  test("passes (calls next) when session user has isCostReader: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isCostReader: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireCostReader(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled, "next() should be called for a cost-reader user");
      assert.equal(res.statusCode, undefined);
    });
  });

  test("passes (calls next) when session user has both isAdmin: true and isCostReader: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: true, isCostReader: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireCostReader(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled);
    });
  });

  test("blocks with 403 when user has neither isAdmin nor isCostReader", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: false, isCostReader: false }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireCostReader(req as Request, res as unknown as Response, next);

      assert.ok(!nextCalled, "next() must NOT be called for a user without cost-reader or admin");
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
    });
  });

  test("blocks with 403 when there is no session user at all", () => {
    withEntra(() => {
      const req = makeReq(undefined);
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireCostReader(req as Request, res as unknown as Response, next);

      assert.ok(!nextCalled, "next() must NOT be called with no session");
      assert.equal(res.statusCode, 403);
    });
  });
});

// ---------------------------------------------------------------------------
// requireAuth — Entra-configured mode
// ---------------------------------------------------------------------------

describe("requireAuth (Entra configured)", () => {
  test("passes when a session user is present", () => {
    withEntra(() => {
      const req = makeReq(makeUser());
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireAuth(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled);
    });
  });

  test("blocks with 401 when no session user", () => {
    withEntra(() => {
      const req = makeReq(undefined);
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireAuth(req as Request, res as unknown as Response, next);

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: "unauthorized" });
    });
  });
});

// ---------------------------------------------------------------------------
// requireAdmin — Entra-configured mode
// ---------------------------------------------------------------------------

describe("requireAdmin (Entra configured)", () => {
  test("passes when session user has isAdmin: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireAdmin(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled);
    });
  });

  test("blocks with 403 when user is not admin", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: false }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireAdmin(req as Request, res as unknown as Response, next);

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { error: "forbidden", requiredGroup: "Orbit-Admins" });
    });
  });
});

// ---------------------------------------------------------------------------
// requireEngineerOrAdmin — Entra-configured mode
// ---------------------------------------------------------------------------

describe("requireEngineerOrAdmin (Entra configured)", () => {
  test("passes when session user has isAdmin: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireEngineerOrAdmin(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled);
    });
  });

  test("passes when session user has isEngineer: true", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isEngineer: true }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireEngineerOrAdmin(req as Request, res as unknown as Response, next);

      assert.ok(nextCalled);
    });
  });

  test("blocks with 403 when user is neither admin nor engineer", () => {
    withEntra(() => {
      const req = makeReq(makeUser({ isAdmin: false, isEngineer: false }));
      const res = makeRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      requireEngineerOrAdmin(req as Request, res as unknown as Response, next);

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { error: "forbidden", requiredGroup: "Orbit-Admins or Orbit-Engineers" });
    });
  });
});
