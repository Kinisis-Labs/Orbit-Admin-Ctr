import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider";
import { useMyPermissions } from "../../../../services/rbac";
import { datasetAdminConfiguration } from "../configuration";

export function CorpusPermissionBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const permissions = useMyPermissions();
  if (datasetAdminConfiguration.developerMode) return children;
  if (permissions.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-[var(--orbit-text-muted)]">
        Checking access…
      </div>
    );
  }
  if (
    !user.isAdmin &&
    !permissions.data?.permissions.some((permission) =>
      ["grailscan.corpus.view", "grailscan.corpus.reference.view"].includes(permission),
    )
  ) {
    return <Navigate to="/" replace />;
  }
  return children;
}
