import { createContext, useContext } from "react";

export type ScopeContextValue = {
  scope: string;
  setScope: (v: string) => void;
};

export const ScopeContext = createContext<ScopeContextValue | null>(null);

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within a ScopeProvider");
  return ctx;
}
