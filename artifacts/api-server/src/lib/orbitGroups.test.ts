import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveOrbitGroups, COST_READER_CLIENT_ID } from "./orbitGroups.js";

const GUID_AUTHORIZED = "aaaaaaaa-0000-0000-0000-000000000001";
const GUID_ADMIN = "bbbbbbbb-0000-0000-0000-000000000002";
const GUID_ENGINEER = "cccccccc-0000-0000-0000-000000000003";
const GUID_COST_READER = "dddddddd-0000-0000-0000-000000000004";
const GUID_FINOPS = "eeeeeeee-0000-0000-0000-000000000005";

const FULL_CFG = {
  authorizedGroupId: GUID_AUTHORIZED,
  adminGroupId: GUID_ADMIN,
  engineerGroupId: GUID_ENGINEER,
  costReaderGroupId: GUID_COST_READER,
  finopsGroupId: GUID_FINOPS,
};

describe("resolveOrbitGroups", () => {
  test("returns empty array when user is not a member of any configured group", () => {
    const result = resolveOrbitGroups(FULL_CFG, []);
    assert.deepEqual(result, []);
  });

  test("resolves Orbit-Authorized-Users when GUID is in token", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "orbit-authorized-users");
    assert.equal(result[0].displayName, "Orbit-Authorized-Users");
  });

  test("resolves Orbit-Admins (optional group) when ENTRA_ADMIN_GROUP_ID is set and user is a member", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_ADMIN]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes("orbit-admins"), "Expected orbit-admins to be resolved");
    assert.ok(ids.includes("orbit-authorized-users"));
    assert.equal(result.find((g) => g.id === "orbit-admins")?.displayName, "Orbit-Admins");
  });

  test("resolves Orbit-Engineers (optional group) when ENTRA_ENGINEER_GROUP_ID is set and user is a member", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_ENGINEER]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes("orbit-engineers"), "Expected orbit-engineers to be resolved");
    assert.equal(result.find((g) => g.id === "orbit-engineers")?.displayName, "Orbit-Engineers");
  });

  test("resolves Orbit-Cost-Readers when ENTRA_COST_READER_GROUP_ID is set and user is a member", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_COST_READER]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes(COST_READER_CLIENT_ID), "Expected cost-readers to be resolved");
    assert.equal(result.find((g) => g.id === COST_READER_CLIENT_ID)?.displayName, "Orbit-Cost-Readers");
  });

  test("resolves Orbit-FinOps (optional group) when ENTRA_FINOPS_GROUP_ID is set and user is a member", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_FINOPS]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes("orbit-finops"), "Expected orbit-finops to be resolved");
    assert.equal(result.find((g) => g.id === "orbit-finops")?.displayName, "Orbit-FinOps");
  });

  test("resolves all five groups when user is a member of all", () => {
    const result = resolveOrbitGroups(FULL_CFG, [
      GUID_AUTHORIZED,
      GUID_ADMIN,
      GUID_ENGINEER,
      GUID_COST_READER,
      GUID_FINOPS,
    ]);
    assert.equal(result.length, 5);
    const ids = new Set(result.map((g) => g.id));
    assert.ok(ids.has("orbit-authorized-users"));
    assert.ok(ids.has("orbit-admins"));
    assert.ok(ids.has("orbit-engineers"));
    assert.ok(ids.has(COST_READER_CLIENT_ID));
    assert.ok(ids.has("orbit-finops"));
  });

  test("does NOT resolve optional groups whose env var is undefined (not configured)", () => {
    const cfgWithoutOptionals = {
      authorizedGroupId: GUID_AUTHORIZED,
      adminGroupId: undefined,
      engineerGroupId: undefined,
      costReaderGroupId: GUID_COST_READER,
      finopsGroupId: undefined,
    };
    const result = resolveOrbitGroups(cfgWithoutOptionals, [
      GUID_AUTHORIZED,
      GUID_ADMIN,
      GUID_ENGINEER,
      GUID_COST_READER,
      GUID_FINOPS,
    ]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes("orbit-authorized-users"), "authorized-users should still resolve");
    assert.ok(ids.includes(COST_READER_CLIENT_ID), "cost-readers should still resolve");
    assert.ok(!ids.includes("orbit-admins"), "orbit-admins must NOT resolve when adminGroupId is undefined");
    assert.ok(!ids.includes("orbit-engineers"), "orbit-engineers must NOT resolve when engineerGroupId is undefined");
    assert.ok(!ids.includes("orbit-finops"), "orbit-finops must NOT resolve when finopsGroupId is undefined");
  });

  test("does NOT resolve groups whose GUID is configured but NOT in the user token", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED]);
    const ids = result.map((g) => g.id);
    assert.ok(!ids.includes("orbit-admins"), "orbit-admins must not appear when user is not a member");
    assert.ok(!ids.includes("orbit-engineers"), "orbit-engineers must not appear when user is not a member");
    assert.ok(!ids.includes("orbit-finops"), "orbit-finops must not appear when user is not a member");
  });

  // --- admin-implies-cost-reader ---

  test("admin user gets cost-reader injected when NOT explicitly in the cost-reader Entra group", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_ADMIN]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes(COST_READER_CLIENT_ID), "admin must imply cost-reader even without explicit group membership");
    assert.ok(ids.includes("orbit-admins"), "orbit-admins should also be present");
  });

  test("admin user gets cost-reader injected when costReaderGroupId is not configured at all", () => {
    const cfgNoReader = {
      authorizedGroupId: GUID_AUTHORIZED,
      adminGroupId: GUID_ADMIN,
      engineerGroupId: undefined,
      costReaderGroupId: undefined,
      finopsGroupId: undefined,
    };
    const result = resolveOrbitGroups(cfgNoReader, [GUID_AUTHORIZED, GUID_ADMIN]);
    const ids = result.map((g) => g.id);
    assert.ok(ids.includes(COST_READER_CLIENT_ID), "admin must still get cost-reader even when costReaderGroupId is absent from config");
  });

  test("no duplicate cost-reader entry when admin is also explicitly in the cost-reader Entra group", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED, GUID_ADMIN, GUID_COST_READER]);
    const costReaderEntries = result.filter((g) => g.id === COST_READER_CLIENT_ID);
    assert.equal(costReaderEntries.length, 1, "cost-reader must appear exactly once, not duplicated for admin+member");
  });

  test("non-admin user without cost-reader group membership does NOT get cost-reader injected", () => {
    const result = resolveOrbitGroups(FULL_CFG, [GUID_AUTHORIZED]);
    const ids = result.map((g) => g.id);
    assert.ok(!ids.includes(COST_READER_CLIENT_ID), "cost-reader must not be injected for an ordinary authorized user");
  });

  test("admin-implies-cost-reader does NOT fire when adminGroupId is not configured", () => {
    const cfgNoAdmin = {
      authorizedGroupId: GUID_AUTHORIZED,
      adminGroupId: undefined,
      engineerGroupId: undefined,
      costReaderGroupId: undefined,
      finopsGroupId: undefined,
    };
    // Pass GUID_ADMIN in the token anyway — should be ignored since adminGroupId is unconfigured
    const result = resolveOrbitGroups(cfgNoAdmin, [GUID_AUTHORIZED, GUID_ADMIN]);
    const ids = result.map((g) => g.id);
    assert.ok(!ids.includes(COST_READER_CLIENT_ID), "cost-reader must not be injected when adminGroupId is not configured");
  });

  test("client-facing IDs match the IDs used by the frontend ORBIT_GROUPS constant", () => {
    const FRONTEND_ORBIT_GROUP_IDS = [
      "orbit-authorized-users",
      "orbit-admins",
      "orbit-engineers",
      COST_READER_CLIENT_ID,
      "orbit-finops",
    ];
    const result = resolveOrbitGroups(FULL_CFG, [
      GUID_AUTHORIZED,
      GUID_ADMIN,
      GUID_ENGINEER,
      GUID_COST_READER,
      GUID_FINOPS,
    ]);
    for (const group of result) {
      assert.ok(
        FRONTEND_ORBIT_GROUP_IDS.includes(group.id),
        `Group id "${group.id}" is not in the frontend ORBIT_GROUPS list — badge matching will break`,
      );
    }
  });
});
