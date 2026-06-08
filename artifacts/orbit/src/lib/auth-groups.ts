import type { EntraGroup } from "./auth-types";

export const AUTHORIZED_USERS_GROUP: EntraGroup = {
  id: "orbit-authorized-users",
  displayName: "Orbit-Authorized-Users",
  description: "Baseline access — required to load Orbit at all.",
};

export const ADMIN_GROUP: EntraGroup = {
  id: "orbit-admins",
  displayName: "Orbit-Admins",
  description:
    "Platform administration: feature flags, group management, preferences for all users.",
};

export const ENGINEER_GROUP: EntraGroup = {
  id: "orbit-engineers",
  displayName: "Orbit-Engineers",
  description: "Operational actions on Kinisis applications.",
};

export const COST_READER_GROUP: EntraGroup = {
  id: "b7e3-aad-cost-readers",
  displayName: "Orbit-Cost-Readers",
  description: "Allowed to view cost, billing, and revenue data in Orbit.",
};

export const FINOPS_GROUP: EntraGroup = {
  id: "orbit-finops",
  displayName: "Orbit-FinOps",
  description: "Cost Management write actions (future).",
};

/** All five Orbit security groups in display order. */
export const ALL_ORBIT_GROUPS: EntraGroup[] = [
  AUTHORIZED_USERS_GROUP,
  ADMIN_GROUP,
  ENGINEER_GROUP,
  COST_READER_GROUP,
  FINOPS_GROUP,
];

/** All five groups are toggleable in the dev simulator. */
export const TOGGLEABLE_GROUPS: EntraGroup[] = [
  AUTHORIZED_USERS_GROUP,
  ADMIN_GROUP,
  ENGINEER_GROUP,
  COST_READER_GROUP,
  FINOPS_GROUP,
];
