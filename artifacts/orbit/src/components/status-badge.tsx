import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  
  let dotColorClass = "bg-muted-foreground";
  let textClass = "text-muted-foreground";

  if (normalized === "healthy") {
    dotColorClass = "bg-[#7FBA00]";
    textClass = "text-foreground";
  } else if (normalized === "degraded" || normalized === "warning") {
    dotColorClass = "bg-[#FF8C00]";
    textClass = "text-foreground";
  } else if (normalized === "unhealthy" || normalized === "critical" || normalized === "error" || normalized === "failed") {
    dotColorClass = "bg-[#E81123]";
    textClass = "text-foreground";
  } else if (normalized === "info" || normalized === "running") {
    dotColorClass = "bg-[#0078D4]";
    textClass = "text-foreground";
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("w-2 h-2 rounded-sm", dotColorClass)} aria-hidden="true" />
      <span className={cn("text-xs capitalize tracking-tight", textClass)}>
        {status}
      </span>
    </div>
  );
}
