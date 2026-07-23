import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { datasetAdminConfiguration } from "../configuration";
import { Panel, StatusBadge } from "./Ui";

export function DatasetDevelopmentStatus({ unavailable = false }: { unavailable?: boolean }) {
  const services = [
    ["Reference Provider", "Card Hedge", datasetAdminConfiguration.providerCardHedge],
    ["Synchronization Worker", "Not yet configured", false],
    ["Reference Dataset Registry", "Empty", datasetAdminConfiguration.referenceDatasets],
    ["Dataset Publication", "Ready", datasetAdminConfiguration.publication],
    ["Dataset Versioning", "Ready", datasetAdminConfiguration.versioning],
    ["Regression Datasets", "Ready", datasetAdminConfiguration.regression],
    ["Coverage Analytics", "Ready", datasetAdminConfiguration.coverage],
    ["Health Monitoring", "Ready", datasetAdminConfiguration.health],
  ] as const;

  return (
    <Panel className="border-amber-500/30 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Dataset Administration configuration</h2>
          <p className="mt-1 text-sm text-[var(--orbit-text-secondary)]">
            {unavailable
              ? "Dataset Synchronization Service is not yet configured. Development mode keeps this control plane available."
              : "Development mode exposes provider, publication, and ML-readiness diagnostics while services are configured."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {services.map(([label, detail, enabled]) => (
          <div key={label} className="rounded-lg border border-[var(--orbit-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{label}</p>
              {enabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <CircleDashed className="h-4 w-4 text-amber-400" />
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--orbit-text-muted)]">{detail}</p>
            <div className="mt-2">
              <StatusBadge value={enabled ? "ready" : "not_yet_configured"} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
