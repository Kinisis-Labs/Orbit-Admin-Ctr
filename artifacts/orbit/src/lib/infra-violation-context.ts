import { createContext, useContext } from "react";
import type { ActiveViolation } from "@/hooks/use-infra-threshold-alerts";

export type InfraViolationContextValue = {
  activeViolations: ActiveViolation[];
};

export const InfraViolationContext =
  createContext<InfraViolationContextValue>({ activeViolations: [] });

export function useInfraViolations(): ActiveViolation[] {
  return useContext(InfraViolationContext).activeViolations;
}
