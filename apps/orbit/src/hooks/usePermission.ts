import { useMyPermissions } from "../services/rbac";
import { useAuth } from "../modules/auth/AuthProvider";

/**
 * Returns true if the current user holds the given permission name
 * (Application.Module.Action format) OR is an admin (admins bypass all checks).
 */
export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  const { data } = useMyPermissions();

  if (user.isAdmin) return true;
  return data?.permissions.includes(permission) ?? false;
}

/**
 * Returns true if the current user holds ANY of the given permissions OR is an admin.
 */
export function useAnyPermission(permissions: string[]): boolean {
  const { user } = useAuth();
  const { data } = useMyPermissions();

  if (user.isAdmin) return true;
  const userPerms = new Set(data?.permissions ?? []);
  return permissions.some((p) => userPerms.has(p));
}
