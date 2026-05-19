import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  
  if (normalized === "healthy") {
    return (
      <Badge variant="outline" className={cn("bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono", className)}>
        HEALTHY
      </Badge>
    );
  }
  if (normalized === "degraded" || normalized === "warning") {
    return (
      <Badge variant="outline" className={cn("bg-amber-500/10 text-amber-500 border-amber-500/20 px-2 py-0.5 text-[10px] font-mono", className)}>
        {status.toUpperCase()}
      </Badge>
    );
  }
  if (normalized === "unhealthy" || normalized === "critical" || normalized === "error") {
    return (
      <Badge variant="outline" className={cn("bg-red-500/10 text-red-500 border-red-500/20 px-2 py-0.5 text-[10px] font-mono", className)}>
        {status.toUpperCase()}
      </Badge>
    );
  }
  if (normalized === "info") {
    return (
      <Badge variant="outline" className={cn("bg-blue-500/10 text-blue-500 border-blue-500/20 px-2 py-0.5 text-[10px] font-mono", className)}>
        {status.toUpperCase()}
      </Badge>
    );
  }
  
  return (
    <Badge variant="outline" className={cn("bg-muted text-muted-foreground border-border px-2 py-0.5 text-[10px] font-mono", className)}>
      {status.toUpperCase() || "UNKNOWN"}
    </Badge>
  );
}
