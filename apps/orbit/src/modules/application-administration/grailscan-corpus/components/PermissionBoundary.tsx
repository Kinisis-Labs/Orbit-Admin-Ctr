import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider";
import { useMyPermissions } from "../../../../services/rbac";

export function CorpusPermissionBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const permissions = useMyPermissions();
  if (permissions.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-[var(--orbit-text-muted)]">
        Checking access…
      </div>
    );
  }
  if (!user.isAdmin && !permissions.data?.permissions.includes("grailscan.corpus.view")) {
    return <Navigate to="/" replace />;
  }
  return children;
}
