import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ADMIN_GROUP, COST_READER_GROUP } from "@/lib/auth-groups";

export function AdminAccessBadge() {
  const { hasGroup } = useAuth();
  if (!hasGroup(ADMIN_GROUP.id) || hasGroup(COST_READER_GROUP.id)) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-violet-500/30 bg-violet-500/10 text-violet-400 text-[11px] font-medium">
      <ShieldCheck className="h-3 w-3 shrink-0" />
      Viewing via {ADMIN_GROUP.displayName}
    </span>
  );
}
