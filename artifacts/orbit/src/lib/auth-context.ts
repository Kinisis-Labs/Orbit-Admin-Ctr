import { createContext } from "react";
import type { EntraGroup, EntraUser } from "./auth-types";

export type AuthMode = "entra" | "mock";

/**
 * A dedicated context that carries only the access-contact address.
 * AuthProvider always mounts this wrapper, so components rendered in the
 * auth-error path (DeniedNotice, AuthNotice) can read it even before the
 * full AuthContext.Provider is mounted.
 */
export const AccessContactContext = createContext<string>("orbit-access@kinisislabs.com");

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
  /** Only present in mock mode — revoke all toggled groups and restore fresh defaults in one click. */
  resetGroups?: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
