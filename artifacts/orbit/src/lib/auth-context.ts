import { createContext } from "react";
import type { EntraGroup, EntraUser } from "./auth-types";

export type AuthContextValue = {
  user: EntraUser;
  groups: EntraGroup[];
  hasGroup: (groupId: string) => boolean;
  grantGroup: (group: EntraGroup) => void;
  revokeGroup: (groupId: string) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
