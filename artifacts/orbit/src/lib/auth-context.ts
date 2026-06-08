import { createContext } from "react";
import type { EntraGroup, EntraUser } from "./auth-types";

export type AuthMode = "entra" | "mock";

export type AuthContextValue = {
  user: EntraUser;
  groups: EntraGroup[];
  hasGroup: (groupId: string) => boolean;
  mode: AuthMode;
  isMock: boolean;
  signOut: () => void;
  /** The access-request contact address served by /api/auth/me (or the fallback default). */
  accessContact: string;
  /** Only present in mock mode — grant a group for the current dev session. */
  grantGroup?: (id: string) => void;
  /** Only present in mock mode — revoke a group for the current dev session. */
  revokeGroup?: (id: string) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
