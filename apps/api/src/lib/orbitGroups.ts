import type { EntraConfig } from "./entra.js";

export type OrbitGroup = { id: string; displayName: string; description: string };

export const COST_READER_CLIENT_ID = "b7e3-aad-cost-readers";

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
  const resolved = registry
    .filter((r) => r.objectId !== undefined && member.has(r.objectId))
    .map((r) => r.group);

  const isAdmin =
    cfg.adminGroupId !== undefined && member.has(cfg.adminGroupId);
  const hasCostReader = resolved.some((g) => g.id === COST_READER_CLIENT_ID);
  if (isAdmin && !hasCostReader) {
    resolved.push({
      id: COST_READER_CLIENT_ID,
      displayName: "Orbit-Cost-Readers",
      description: "Allowed to view cost, billing, and revenue data in Orbit.",
    });
  }

  return resolved;
}
