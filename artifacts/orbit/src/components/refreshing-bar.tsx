import { cn } from "@/lib/utils";

interface RefreshingBarProps {
  isFetching: boolean;
  isLoading: boolean;
  className?: string;
}

export function RefreshingBar({ isFetching, isLoading, className }: RefreshingBarProps) {
  if (!isFetching || isLoading) return null;
  return (
    <div className={cn("h-0.5 w-full overflow-hidden bg-transparent", className)}>
      <div className="h-full bg-primary/60 animate-[progress-bar_1.2s_ease-in-out_infinite]" />
    </div>
  );
}
