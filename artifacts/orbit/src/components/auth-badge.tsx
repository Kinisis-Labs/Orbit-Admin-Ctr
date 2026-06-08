import { Badge } from "@/components/ui/badge";

interface AuthBadgeProps {
  userAuth: "clerk" | "entra" | "none";
  onClick?: () => void;
  active?: boolean;
}

export function AuthBadge({ userAuth, onClick, active }: AuthBadgeProps) {
  const isClickable = onClick !== undefined;
  const ringClass = active ? "ring-2 ring-offset-1" : "";
  const cursorClass = isClickable ? "cursor-pointer select-none" : "";

  if (userAuth === "clerk") {
    return (
      <Badge
        variant="outline"
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
        className={`text-[11px] h-5 px-1.5 font-medium border-violet-400/60 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 ${ringClass} ring-violet-400 ${cursorClass}`}
      >
        Clerk
      </Badge>
    );
  }
  if (userAuth === "entra") {
    return (
      <Badge
        variant="outline"
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
        className={`text-[11px] h-5 px-1.5 font-medium border-blue-400/60 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 ${ringClass} ring-blue-400 ${cursorClass}`}
      >
        Entra ID
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      className={`text-[11px] h-5 px-1.5 font-medium border-border text-muted-foreground ${ringClass} ring-border ${cursorClass}`}
    >
      Public
    </Badge>
  );
}
