import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ForceRefreshButton({
  isRefreshing,
  isCoolingDown,
  onRefresh,
}: {
  isRefreshing: boolean;
  isCoolingDown: boolean;
  onRefresh: () => void;
}) {
  const disabled = isRefreshing || isCoolingDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[10px] rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted gap-1"
      onClick={onRefresh}
      disabled={disabled}
      title={isCoolingDown ? "Recently refreshed — wait 30 s before refreshing again" : "Bypass cache and fetch latest data from Azure"}
    >
      <RefreshCw className={`h-3 w-3${isRefreshing ? " animate-spin" : ""}`} />
      {isRefreshing ? "Refreshing…" : isCoolingDown ? "Just refreshed" : "Force refresh"}
    </Button>
  );
}
