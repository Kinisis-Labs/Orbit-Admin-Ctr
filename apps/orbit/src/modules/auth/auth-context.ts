import { createContext } from "react";
import type { EntraGroup, EntraUser } from "./auth-types";

export type AuthMode = "entra";

export const AccessContactContext = createContext<string>("support@kinisislabs.com");

export type AuthContextValue = {
  user: EntraUser;
  groups: EntraGroup[];
  hasGroup: (groupId: string) => boolean;
  mode: AuthMode;
  signOut: () => void;
  accessContact: string;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
