import { ShieldAlert, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, type EntraGroup } from "@/lib/auth";

export function AccessDenied({
  resource,
  requiredGroup,
}: {
  resource: string;
  requiredGroup: EntraGroup;
}) {
  const { user } = useAuth();

  return (
    <div className="max-w-2xl mx-auto mt-10 bg-card border border-border shadow-sm">
      <div className="flex items-start gap-4 p-6 border-b border-border">
        <div className="h-10 w-10 shrink-0 rounded-sm bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">You don't have access to this page</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Access to <span className="font-medium text-foreground">{resource}</span> is restricted
            by an Entra ID security group.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-[13px] p-6 border-b border-border">
        <dt className="text-muted-foreground">Signed in as</dt>
        <dd className="font-mono text-foreground">{user.userPrincipalName}</dd>

        <dt className="text-muted-foreground">Required group</dt>
        <dd>
          <span className="font-mono text-foreground">{requiredGroup.displayName}</span>
          <div className="text-[12px] text-muted-foreground mt-0.5">{requiredGroup.description}</div>
        </dd>

        <dt className="text-muted-foreground">Your current groups</dt>
        <dd>
          <CurrentGroupChips />
        </dd>
      </dl>

      <div className="p-6 flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" className="rounded-sm h-8 text-[13px]">
          <Mail className="h-3.5 w-3.5 mr-1.5" />
          Request access
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Ask an administrator to add you to{" "}
          <span className="font-mono">{requiredGroup.displayName}</span> in Entra ID.
        </span>
      </div>
    </div>
  );
}

function CurrentGroupChips() {
  const { groups } = useAuth();
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <span
          key={g.id}
          className="inline-flex items-center px-2 py-0.5 border border-border bg-muted/40 text-[11px] font-mono text-foreground"
        >
          {g.displayName}
        </span>
      ))}
    </div>
  );
}

export function RequireGroup({
  group,
  resource,
  children,
}: {
  group: EntraGroup;
  resource: string;
  children: React.ReactNode;
}) {
  const { hasGroup } = useAuth();
  if (!hasGroup(group.id)) {
    return <AccessDenied resource={resource} requiredGroup={group} />;
  }
  return <>{children}</>;
}
