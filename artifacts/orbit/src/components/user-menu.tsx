import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
          className="h-8 w-8 ml-2 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold border border-white/20 hover:opacity-90 transition-opacity"
        >
          {user.initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px] rounded-sm">
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
          <div className="flex flex-wrap gap-1">
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
