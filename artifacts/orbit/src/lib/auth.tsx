import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Mocked Entra ID (Azure AD) identity + group memberships for the prototype.
 *
 * In a real deployment, `currentUser` would come from an MSAL/OIDC token and
 * `groups` would be the `groups` claim (or fetched via Microsoft Graph
 * `/me/memberOf`). The required-group check below would run server-side too.
 */

export type EntraGroup = {
  id: string;
  displayName: string;
  description: string;
};

export type EntraUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string;
  initial: string;
};

// Required group for the Cost Management dashboard.
export const COST_READER_GROUP: EntraGroup = {
  id: "b7e3-aad-cost-readers",
  displayName: "Orbit-Cost-Readers",
  description: "Allowed to view cost, billing, and revenue data in Orbit.",
};

const STORAGE_KEY = "orbit-mock-groups";

const MOCK_USER: EntraUser = {
  id: "user-arielle-mendez",
  displayName: "Arielle Mendez",
  userPrincipalName: "arielle.mendez@kinisis.io",
  jobTitle: "Platform Engineer",
  initial: "A",
};

// All groups the mock user could potentially be a member of.
const MOCK_BASE_GROUPS: EntraGroup[] = [
  { id: "all-staff", displayName: "All-Staff", description: "Everyone at the company." },
  { id: "platform-engineering", displayName: "Platform-Engineering", description: "Platform engineering team." },
];

type AuthContextValue = {
  user: EntraUser;
  groups: EntraGroup[];
  hasGroup: (groupId: string) => boolean;
  grantGroup: (group: EntraGroup) => void;
  revokeGroup: (groupId: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredGroupIds(): string[] {
  if (typeof window === "undefined") return [COST_READER_GROUP.id];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [COST_READER_GROUP.id];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
    return [COST_READER_GROUP.id];
  } catch {
    return [COST_READER_GROUP.id];
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Track only the "toggleable" group IDs the user currently has. Base groups
  // are always included.
  const [toggleableIds, setToggleableIds] = useState<string[]>(loadStoredGroupIds);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toggleableIds));
    } catch {
      /* ignore */
    }
  }, [toggleableIds]);

  const grantGroup = useCallback((group: EntraGroup) => {
    setToggleableIds((ids) => (ids.includes(group.id) ? ids : [...ids, group.id]));
  }, []);

  const revokeGroup = useCallback((groupId: string) => {
    setToggleableIds((ids) => ids.filter((id) => id !== groupId));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const toggleable: EntraGroup[] = [];
    if (toggleableIds.includes(COST_READER_GROUP.id)) toggleable.push(COST_READER_GROUP);
    const groups = [...MOCK_BASE_GROUPS, ...toggleable];
    const groupIds = new Set(groups.map((g) => g.id));
    return {
      user: MOCK_USER,
      groups,
      hasGroup: (id: string) => groupIds.has(id),
      grantGroup,
      revokeGroup,
    };
  }, [toggleableIds, grantGroup, revokeGroup]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
