import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

export function UserMenu() {
  const { user, groups, signOut } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-testid="user-menu-trigger"
          className="h-8 w-8 ml-2 rounded-full bg-[#0078d4] text-white flex items-center justify-center text-xs font-bold border-2 border-white/20 hover:opacity-90 transition-opacity shrink-0"
        >
          {user.initial}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-[300px] p-0 rounded-sm overflow-hidden">
        {/* M365-style banner + avatar */}
        <div className="relative">
          <div className="h-14 bg-[#0078d4]" />
          <div className="absolute left-1/2 -translate-x-1/2 top-5">
            <div className="h-16 w-16 rounded-full bg-[#0078d4] border-4 border-background flex items-center justify-center text-white text-2xl font-bold select-none shadow-md">
              {user.initial}
            </div>
          </div>
        </div>

        {/* Profile info */}
        <div className="pt-10 pb-4 px-4 text-center">
          <div className="font-semibold text-[15px] text-foreground truncate">{user.displayName}</div>
          <div className="text-[12px] text-muted-foreground font-mono truncate mt-0.5">{user.userPrincipalName}</div>
          {user.jobTitle && (
            <div className="text-[12px] text-muted-foreground mt-0.5">{user.jobTitle}</div>
          )}
        </div>

        {/* Groups */}
        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-4 py-2.5">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">
                Security groups
              </div>
              <div className="flex flex-wrap gap-1">
                {groups.map((g) => (
                  <span
                    key={g.id}
                    className="inline-flex items-center px-1.5 py-0.5 border border-border bg-muted/40 text-[10px] font-mono text-foreground rounded-sm"
                  >
                    {g.displayName}
                  </span>
                ))}
              </div>
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
