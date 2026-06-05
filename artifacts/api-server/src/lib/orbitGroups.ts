import type { EntraConfig } from "./entra";

export type OrbitGroup = { id: string; displayName: string; description: string };

/**
 * Stable client-facing id for the cost-reader capability. Must match
 * COST_READER_GROUP.id in artifacts/orbit/src/lib/auth.tsx so the frontend's
 * hasGroup(COST_READER_GROUP.id) check works in both mock and Entra modes.
 */
export const COST_READER_CLIENT_ID = "b7e3-aad-cost-readers";

/**
 * Orbit's RBAC groups, each mapped to an Entra group object id (GUID) supplied
 * via env. The client-facing `id`s must match the ids used by the frontend
 * (COST_READER_GROUP in artifacts/orbit/src/lib/auth.tsx and ORBIT_GROUPS in
 * artifacts/orbit/src/pages/access.tsx) so hasGroup() and the "My membership"
 * column work identically in mock and Entra modes. A group only resolves when
 * its object id is configured AND present in the user's `groups` claim.
 */
export function resolveOrbitGroups(
  cfg: Pick<
    EntraConfig,
    | "authorizedGroupId"
    | "adminGroupId"
    | "engineerGroupId"
    | "costReaderGroupId"
    | "finopsGroupId"
  >,
  memberGroupIds: string[],
): OrbitGroup[] {
  const registry: Array<{ objectId?: string; group: OrbitGroup }> = [
    {
      objectId: cfg.authorizedGroupId,
      group: {
        id: "orbit-authorized-users",
        displayName: "Orbit-Authorized-Users",
        description: "Baseline access — required to load Orbit at all.",
      },
    },
    {
      objectId: cfg.adminGroupId,
      group: {
        id: "orbit-admins",
        displayName: "Orbit-Admins",
        description:
          "Platform administration: feature flags, group management, preferences for all users.",
      },
    },
    {
      objectId: cfg.engineerGroupId,
      group: {
        id: "orbit-engineers",
        displayName: "Orbit-Engineers",
        description: "Operational actions on Kinisis applications.",
      },
    },
    {
      objectId: cfg.costReaderGroupId,
      group: {
        id: COST_READER_CLIENT_ID,
        displayName: "Orbit-Cost-Readers",
        description: "Allowed to view cost, billing, and revenue data in Orbit.",
      },
    },
    {
      objectId: cfg.finopsGroupId,
      group: {
        id: "orbit-finops",
        displayName: "Orbit-FinOps",
        description: "Cost Management write actions (budgets, allocations).",
      },
    },
  ];
  const member = new Set(memberGroupIds);
  return registry
    .filter((r) => r.objectId !== undefined && member.has(r.objectId))
    .map((r) => r.group);
}
