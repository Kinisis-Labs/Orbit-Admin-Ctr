import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { useAuth, COST_READER_GROUP } from "@/lib/auth";
import { CheckCircle2, XCircle } from "lucide-react";

type GroupDef = {
  id: string;
  displayName: string;
  description: string;
  grants: string[];
};

const ORBIT_GROUPS: GroupDef[] = [
  {
    id: "orbit-authorized-users",
    displayName: "Orbit-Authorized-Users",
    description: "Baseline access — required to load Orbit at all.",
    grants: ["Sign in to Orbit", "View Home, Alerts, Health, Network"],
  },
  {
    id: "orbit-admins",
    displayName: "Orbit-Admins",
    description: "Platform administration: feature flags, group management, preferences for all users.",
    grants: ["Edit feature flags", "Manage Entra group simulation", "View audit log"],
  },
  {
    id: "orbit-engineers",
    displayName: "Orbit-Engineers",
    description: "Operational actions on Kinisis applications.",
    grants: ["Acknowledge alerts", "Trigger refresh / start / restart actions"],
  },
  {
    id: COST_READER_GROUP.id,
    displayName: COST_READER_GROUP.displayName,
    description: COST_READER_GROUP.description,
    grants: ["View Cost Management page", "View per-app Cost tab", "View Budgets & Forecasts"],
  },
  {
    id: "orbit-finops",
    displayName: "Orbit-FinOps",
    description: "Cost Management write actions (future).",
    grants: ["Edit budgets", "Edit cost allocations", "Approve cost exports"],
  },
];

export default function Access() {
  const { hasGroup, user, groups, grantGroup, revokeGroup, mode } = useAuth();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Identity & access"
        subtitle={
          mode === "mock"
            ? "Entra ID groups that govern Orbit. Membership of the simulated user can be toggled for groups marked as such."
            : "Entra ID groups that govern Orbit. Membership is resolved from your real Entra ID token."
        }
      />

      <div className="bg-card border border-border shadow-sm p-4 text-[13px]">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Signed in as</div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">{user.initial}</div>
          <div>
            <div className="font-semibold text-foreground">{user.displayName}</div>
            <div className="text-[12px] text-muted-foreground">{user.userPrincipalName} · {user.jobTitle}</div>
          </div>
        </div>
        <div className="mt-3 text-[12px] text-muted-foreground">
          Member of {groups.length} group{groups.length === 1 ? "" : "s"}: {groups.map((g) => g.displayName).join(", ")}
        </div>
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border"><h2 className="text-sm font-semibold px-2">Orbit security groups</h2></div>
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 font-semibold text-foreground">Group</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">Grants</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">My membership</TableHead>
              {mode === "mock" && (
                <TableHead className="h-8 font-semibold text-foreground text-right w-[140px]">Simulator</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORBIT_GROUPS.map((g) => {
              const isMember = hasGroup(g.id);
              const toggleable = g.id === COST_READER_GROUP.id;
              return (
                <TableRow key={g.id} className="border-b border-border/50 hover:bg-muted/40 align-top">
                  <TableCell className="py-2">
                    <div className="font-medium text-primary">{g.displayName}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 max-w-md">{g.description}</div>
                  </TableCell>
                  <TableCell className="py-2 text-muted-foreground">
                    <ul className="list-disc pl-4 text-[12px] space-y-0.5">{g.grants.map((x) => <li key={x}>{x}</li>)}</ul>
                  </TableCell>
                  <TableCell className="py-2">
                    {isMember ? (
                      <StatusPill tone="ok"><CheckCircle2 className="h-3 w-3 mr-1" /> Member</StatusPill>
                    ) : (
                      <StatusPill tone="muted"><XCircle className="h-3 w-3 mr-1" /> Not a member</StatusPill>
                    )}
                  </TableCell>
                  {mode === "mock" && (
                    <TableCell className="py-2 text-right">
                      {toggleable ? (
                        <button
                          type="button"
                          className="text-primary hover:underline text-[12px]"
                          onClick={() => (isMember ? revokeGroup(g.id) : grantGroup(COST_READER_GROUP))}
                        >
                          {isMember ? "Revoke" : "Grant"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
