import { test, describe } from "node:test";
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
// requireCostReader
// ---------------------------------------------------------------------------

describe("requireCostReader", () => {
  test("passes (calls next) when session user has isAdmin: true", () => {
    const req = makeReq(makeUser({ isAdmin: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireCostReader(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled, "next() should be called for an admin user");
    assert.equal(res.statusCode, undefined, "no status should be set when next() is called");
  });

  test("passes (calls next) when session user has isCostReader: true", () => {
    const req = makeReq(makeUser({ isCostReader: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireCostReader(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled, "next() should be called for a cost-reader user");
    assert.equal(res.statusCode, undefined);
  });

  test("passes (calls next) when session user has both isAdmin: true and isCostReader: true", () => {
    const req = makeReq(makeUser({ isAdmin: true, isCostReader: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireCostReader(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled);
  });

  test("blocks with 403 when user has neither isAdmin nor isCostReader", () => {
    const req = makeReq(makeUser({ isAdmin: false, isCostReader: false }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireCostReader(req as Request, res as unknown as Response, next);

    assert.ok(!nextCalled, "next() must NOT be called for a user without cost-reader or admin");
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "forbidden", requiredGroup: "Orbit-Cost-Readers" });
  });

  test("blocks with 403 when there is no session user at all", () => {
    const req = makeReq(undefined);
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireCostReader(req as Request, res as unknown as Response, next);

    assert.ok(!nextCalled, "next() must NOT be called with no session");
    assert.equal(res.statusCode, 403);
  });
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  test("passes when a session user is present", () => {
    const req = makeReq(makeUser());
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled);
  });

  test("blocks with 401 when no session user", () => {
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

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe("requireAdmin", () => {
  test("passes when session user has isAdmin: true", () => {
    const req = makeReq(makeUser({ isAdmin: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAdmin(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled);
  });

  test("blocks with 403 when user is not admin", () => {
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

// ---------------------------------------------------------------------------
// requireEngineerOrAdmin
// ---------------------------------------------------------------------------

describe("requireEngineerOrAdmin", () => {
  test("passes when session user has isAdmin: true", () => {
    const req = makeReq(makeUser({ isAdmin: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireEngineerOrAdmin(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled);
  });

  test("passes when session user has isEngineer: true", () => {
    const req = makeReq(makeUser({ isEngineer: true }));
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireEngineerOrAdmin(req as Request, res as unknown as Response, next);

    assert.ok(nextCalled);
  });

  test("blocks with 403 when user is neither admin nor engineer", () => {
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
