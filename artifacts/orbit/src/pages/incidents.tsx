import { ExternalLink, Workflow, AlertOctagon, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-header";

export default function Incidents() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidents"
        subtitle="Incident management is owned by ServiceNow. Orbit will surface live tickets once the integration is enabled."
        right={
          <Button variant="default" size="sm" className="h-8 rounded-sm" disabled>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open in ServiceNow
          </Button>
        }
      />

      <div className="bg-card border border-border shadow-sm p-6">
        <div className="flex items-start gap-4 max-w-3xl">
          <div className="shrink-0 h-10 w-10 rounded-sm bg-primary/10 text-primary flex items-center justify-center">
            <Workflow className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-base font-semibold text-foreground">ServiceNow integration not yet enabled</h2>
              <StatusPill tone="warn">Not connected</StatusPill>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Incidents for Kinisis applications are managed in ServiceNow. To bring live incident
              data into Orbit, the platform team needs to provision a ServiceNow application
              registration with read access to the <code className="text-foreground bg-muted px-1 py-0.5 rounded-sm text-[12px]">incident</code> and{" "}
              <code className="text-foreground bg-muted px-1 py-0.5 rounded-sm text-[12px]">cmdb_ci_service</code> tables, then store the
              credentials in <code className="text-foreground bg-muted px-1 py-0.5 rounded-sm text-[12px]">kv-orbit-prod</code> as{" "}
              <code className="text-foreground bg-muted px-1 py-0.5 rounded-sm text-[12px]">servicenow-api-token</code>.
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed mt-3">
              Until then, follow your existing process to open and triage incidents directly in ServiceNow.
              Alerts raised from Azure Monitor will continue to surface on the{" "}
              <a href="./alerts" className="text-primary hover:underline">Alerts</a> page.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border shadow-sm">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold">When connected, this page will show</h3>
          </div>
          <ul className="p-4 space-y-2 text-[13px] text-muted-foreground">
            <FeatureRow icon={<AlertOctagon className="h-4 w-4 text-amber-500" />}>
              Active P1 / P2 incidents grouped by Kinisis application
            </FeatureRow>
            <FeatureRow icon={<Inbox className="h-4 w-4 text-primary" />}>
              Assignment group, owner, and last-update timestamp from ServiceNow
            </FeatureRow>
            <FeatureRow icon={<Workflow className="h-4 w-4 text-emerald-500" />}>
              Linked Azure Monitor alerts that auto-opened each ticket
            </FeatureRow>
            <FeatureRow icon={<ExternalLink className="h-4 w-4 text-primary" />}>
              Deep-link to the underlying ServiceNow record for full history
            </FeatureRow>
          </ul>
        </div>

        <div className="bg-card border border-border shadow-sm">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold">Integration requirements</h3>
          </div>
          <ul className="p-4 space-y-2 text-[13px] text-muted-foreground list-disc pl-8">
            <li>ServiceNow instance URL (e.g. <code className="text-foreground">kinisis.service-now.com</code>)</li>
            <li>OAuth application with <code className="text-foreground">incident.read</code> and <code className="text-foreground">cmdb.read</code> scopes</li>
            <li>CMDB CI naming convention that maps to Kinisis app IDs (e.g. <code className="text-foreground">grailbabe-prod</code>)</li>
            <li>Allow-list <code className="text-foreground">orbit.kinisis.internal</code> in ServiceNow IP access controls</li>
            <li>FinOps sign-off (ServiceNow API calls are metered)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
