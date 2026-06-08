import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CheckCircle2, XCircle, FlaskConical, Mail, RotateCcw } from "lucide-react";

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
    grants: [
      "Edit feature flags",
      "Manage Entra group simulation",
      "View audit log",
      "All FinOps surfaces (implicit cost-reader access): Cost Management, per-app Cost & Ledger tabs, Play Subscriptions, App Store Subscriptions",
    ],
  },
  {
    id: "orbit-engineers",
    displayName: "Orbit-Engineers",
    description: "Operational actions on Kinisis applications.",
    grants: ["Acknowledge alerts", "Trigger refresh / start / restart actions"],
  },
  {
    id: "b7e3-aad-cost-readers",
    displayName: "Orbit-Cost-Readers",
    description: "Allowed to view cost, billing, and revenue data in Orbit.",
    grants: [
      "View Cost Management page",
      "View per-app Cost tab",
      "View Budgets & Forecasts",
      "View per-app Ledger tab",
      "View Play Subscriptions page",
      "View App Store Subscriptions page",
    ],
  },
  {
    id: "orbit-finops",
    displayName: "Orbit-FinOps",
    description: "Cost Management write actions (future).",
    grants: ["Edit budgets", "Edit cost allocations", "Approve cost exports"],
  },
];


export default function Access() {
  const { hasGroup, user, groups, isMock, grantGroup, revokeGroup, resetGroups, accessContact } = useAuth();
  const [confirmingReset, setConfirmingReset] = useState(false);

  function handleResetClick() {
    setConfirmingReset(true);
  }

  function handleResetConfirm() {
    resetGroups?.();
    setConfirmingReset(false);
  }

  function handleResetCancel() {
    setConfirmingReset(false);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Identity & access"
        subtitle={
          isMock
            ? "Mock/dev mode — use the Simulator column to preview group-restricted surfaces."
            : "Entra ID groups that govern Orbit. Membership is resolved from your real Entra ID token."
        }
      />

      {isMock && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-400">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Dev simulator active.</strong> Orbit-Authorized-Users is always granted. Toggle the other groups below to preview access-restricted surfaces. State is saved in localStorage and persists across refreshes.
          </span>
        </div>
      )}

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

      <div className="bg-card border border-border shadow-sm px-4 py-3 flex items-center gap-2 text-[13px]">
        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Access requests:</span>
        <a
          href={`mailto:${accessContact}`}
          className="text-primary hover:underline font-medium"
        >
          {accessContact}
        </a>
      </div>

      <div className="bg-card border border-border shadow-sm">
        <div className="p-2 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold px-2">Orbit security groups</h2>
          {isMock && (
            confirmingReset ? (
              <div className="flex items-center gap-1.5 mr-2">
                <span className="text-[11px] text-amber-400">Reset all groups?</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={handleResetConfirm}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={handleResetCancel}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 mr-2"
                onClick={handleResetClick}
              >
                <RotateCcw className="h-3 w-3" />
                Reset simulator
              </Button>
            )
          )}
        </div>
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 font-semibold text-foreground">Group</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">Grants</TableHead>
              <TableHead className="h-8 font-semibold text-foreground">My membership</TableHead>
              {isMock && (
                <TableHead className="h-8 font-semibold text-foreground">
                  <span className="flex items-center gap-1">
                    <FlaskConical className="h-3 w-3 text-amber-400" />
                    Simulator
                  </span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORBIT_GROUPS.map((g) => {
              const isMember = hasGroup(g.id);
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
                  {isMock && (
                    <TableCell className="py-2">
                      {isMember ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px] border-destructive/50 text-destructive hover:bg-destructive/10"
                          onClick={() => revokeGroup?.(g.id)}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px] border-primary/50 text-primary hover:bg-primary/10"
                          onClick={() => grantGroup?.(g.id)}
                        >
                          Grant
                        </Button>
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
