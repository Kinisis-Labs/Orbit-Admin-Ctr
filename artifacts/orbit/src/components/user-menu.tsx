import { LogOut } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, COST_READER_GROUP, ADMIN_GROUP } from "@/lib/auth";

/**
 * Azure-style avatar in the top-right corner. Opens a dropdown that shows the
 * mock signed-in user, their Entra group memberships, and a toggle to simulate
 * granting / revoking the cost-readers group (for demoing the access-control
 * behavior on the Cost Management page).
 */
export function UserMenu() {
  const { user, groups, hasGroup, grantGroup, revokeGroup, mode, signOut } = useAuth();
  const hasCost = hasGroup(COST_READER_GROUP.id);
  const hasAdmin = hasGroup(ADMIN_GROUP.id);

  const toggleCost = (next: boolean) => {
    if (next) grantGroup(COST_READER_GROUP);
    else revokeGroup(COST_READER_GROUP.id);
  };

  const toggleAdmin = (next: boolean) => {
    if (next) grantGroup(ADMIN_GROUP);
    else revokeGroup(ADMIN_GROUP.id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-testid="user-menu-trigger"
          className="h-8 w-8 ml-2 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold border border-white/20 hover:opacity-90 transition-opacity"
        >
          {user.initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px] rounded-sm">
        <DropdownMenuLabel className="px-3 py-2">
          <div className="font-semibold text-[13px] text-foreground truncate">{user.displayName}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{user.userPrincipalName}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{user.jobTitle}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">
            Entra ID groups
          </div>
          <div className="flex flex-wrap gap-1 mb-3">
            {groups.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-[10px] font-mono text-foreground"
              >
                {g.displayName}
              </span>
            ))}
          </div>
        </div>
        {mode === "mock" && (
          <>
            <DropdownMenuSeparator />
            <div className="px-3 py-2 space-y-2">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">
                Permission simulator (mock)
              </div>
              <label className="flex items-start gap-2 cursor-pointer" htmlFor="admin-toggle">
                <Switch
                  id="admin-toggle"
                  checked={hasAdmin}
                  onCheckedChange={toggleAdmin}
                  data-testid="toggle-admin"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-medium text-foreground">
                    Member of <span className="font-mono">{ADMIN_GROUP.displayName}</span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Grants full access including all FinOps surfaces.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer" htmlFor="cost-readers-toggle">
                <Switch
                  id="cost-readers-toggle"
                  checked={hasCost}
                  onCheckedChange={toggleCost}
                  data-testid="toggle-cost-readers"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-medium text-foreground">
                    Member of <span className="font-mono">{COST_READER_GROUP.displayName}</span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Required to view Cost Management. Toggle off to preview the no-access state.
                  </span>
                </span>
              </label>
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={signOut}
          data-testid="sign-out"
          className="mx-1 my-1 text-[13px] cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
