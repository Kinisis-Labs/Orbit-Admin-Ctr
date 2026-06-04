import { Badge } from "@/components/ui/badge";

export function AuthBadge({ userAuth }: { userAuth: "clerk" | "entra" | "none" }) {
  if (userAuth === "clerk") {
    return (
      <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-medium border-violet-400/60 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30">
        Clerk
      </Badge>
    );
  }
  if (userAuth === "entra") {
    return (
      <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-medium border-blue-400/60 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30">
        Entra
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[11px] h-5 px-1.5 font-medium border-border text-muted-foreground">
      None
    </Badge>
  );
}
