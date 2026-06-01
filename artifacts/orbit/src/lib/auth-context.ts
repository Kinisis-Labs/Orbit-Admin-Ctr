import { createContext } from "react";
import type { EntraGroup, EntraUser } from "./auth-types";

export type AuthMode = "mock" | "entra";

export type AuthContextValue = {
  user: EntraUser;
  groups: EntraGroup[];
  hasGroup: (groupId: string) => boolean;
  /** No-op in Entra mode (group membership is managed in Entra ID). */
  grantGroup: (group: EntraGroup) => void;
  /** No-op in Entra mode. */
  revokeGroup: (groupId: string) => void;
  mode: AuthMode;
  signOut: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
