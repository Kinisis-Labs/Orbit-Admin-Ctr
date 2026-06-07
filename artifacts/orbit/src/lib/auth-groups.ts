import type { EntraGroup } from "./auth-types";

export const COST_READER_GROUP: EntraGroup = {
  id: "b7e3-aad-cost-readers",
  displayName: "Orbit-Cost-Readers",
  description: "Allowed to view cost, billing, and revenue data in Orbit.",
};

export const ADMIN_GROUP: EntraGroup = {
  id: "orbit-admins",
  displayName: "Orbit-Admins",
  description:
    "Platform administration: feature flags, group management, preferences for all users.",
};
