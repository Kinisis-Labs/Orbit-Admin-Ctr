/**
 * Entra ID staff stats — RBAC group member counts via Microsoft Graph.
 *
 * Uses the same client-credentials Graph token as graphResolver.ts.
 * Requires the Orbit app registration to have the application permission
 * `GroupMember.Read.All` (or `Group.Read.All`) granted with admin consent.
 *
 * Config-gated: returns dataSource="unconfigured" when Entra client creds
 * are absent so the route always responds (never throws).
 */

import { getGraphToken } from "./graphResolver.js";
import { logger } from "./logger.js";

export type StaffGroupStat = {
  id: string;
  name: string;
  memberCount: number;
};

export type StaffStats = {
  groups: StaffGroupStat[];
  dataSource: "live" | "unconfigured";
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, { count: number; expiresAt: number }>();

/** Ordered list of [envKey, display name] pairs — defines the row order in the UI. */
const GROUP_ENV_MAP: [string, string][] = [
  ["ENTRA_AUTHORIZED_GROUP_ID", "Orbit-Authorized-Users"],
  ["ENTRA_COST_READER_GROUP_ID", "Orbit-Cost-Readers"],
  ["ENTRA_ADMIN_GROUP_ID", "Orbit-Admins"],
  ["ENTRA_ENGINEER_GROUP_ID", "Orbit-Engineers"],
  ["ENTRA_FINOPS_GROUP_ID", "Orbit-FinOps"],
];

async function fetchMemberCount(
  token: string,
  groupId: string,
): Promise<number | null> {
  try {
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/groups/${groupId}/members/$count`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ConsistencyLevel: "eventual",
        },
      },
    );
    if (!resp.ok) {
      logger.warn(
        { groupId, status: resp.status },
        "entraStats: member count request failed",
      );
      return null;
    }
    const n = parseInt(await resp.text(), 10);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logger.warn({ err, groupId }, "entraStats: member count error");
    return null;
  }
}

export async function getStaffStats(): Promise<StaffStats> {
  const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET } =
    process.env;
  if (!ENTRA_TENANT_ID || !ENTRA_CLIENT_ID || !ENTRA_CLIENT_SECRET) {
    return { groups: [], dataSource: "unconfigured" };
  }

  const token = await getGraphToken();
  if (!token) return { groups: [], dataSource: "unconfigured" };

  const results = await Promise.all(
    GROUP_ENV_MAP.map(async ([envKey, name]) => {
      const groupId = process.env[envKey];
      if (!groupId) return null;

      const hit = _cache.get(groupId);
      if (hit && Date.now() < hit.expiresAt) {
        return { id: groupId, name, memberCount: hit.count } satisfies StaffGroupStat;
      }

      const count = await fetchMemberCount(token, groupId);
      if (count === null) return null;

      _cache.set(groupId, { count, expiresAt: Date.now() + CACHE_TTL_MS });
      return { id: groupId, name, memberCount: count } satisfies StaffGroupStat;
    }),
  );

  const groups = results.filter((r): r is StaffGroupStat => r !== null);
  logger.info({ groupCount: groups.length }, "entraStats: fetched group stats");
  return { groups, dataSource: "live" };
}
