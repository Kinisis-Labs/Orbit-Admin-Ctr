import { useState } from "react";
import { useListAppleSubscriptions, useListPlaySubscriptions } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Apple, Smartphone, RefreshCw, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function prevMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

type SyncResult = {
  month: string;
  appId: string;
  total: number;
  ingested: number;
  skipped: number;
  errors: number;
  totalGross: number;
  totalFee: number;
  dataSource: "app_store" | "play_store";
};

type SyncState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: SyncResult }
  | { status: "error"; message: string };

function useSyncState() {
  const [states, setStates] = useState<Record<string, SyncState>>({});

  function getState(key: string): SyncState {
    return states[key] ?? { status: "idle" };
  }

  async function triggerSync(
    appId: string,
    store: "app-store" | "play-store",
    month: string,
  ) {
    const key = `${store}:${appId}`;
    setStates((s) => ({ ...s, [key]: { status: "loading" } }));
    try {
      const res = await fetch(
        `/api/apps/${encodeURIComponent(appId)}/ledger/${store}/sync?month=${month}`,
        { method: "POST" },
      );
      if (res.status === 503) {
        const body = await res.json().catch(() => ({ error: "Not configured" }));
        setStates((s) => ({
          ...s,
          [key]: { status: "error", message: (body as { error?: string }).error ?? "Not configured" },
        }));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setStates((s) => ({
          ...s,
          [key]: {
            status: "error",
            message: (body as { error?: string }).error ?? res.statusText,
          },
        }));
        return;
      }
      const result = (await res.json()) as SyncResult;
      setStates((s) => ({ ...s, [key]: { status: "success", result } }));
    } catch (err) {
      setStates((s) => ({
        ...s,
        [key]: {
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }));
    }
  }

  return { getState, triggerSync };
}

function ResultBadge({ result }: { result: SyncResult }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <Badge variant="secondary" className="gap-1">
        <span className="text-muted-foreground">total</span> {result.total}
      </Badge>
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
        <CheckCircle2 className="h-3 w-3" />
        {result.ingested} ingested
      </Badge>
      {result.skipped > 0 && (
        <Badge variant="outline" className="gap-1">
          {result.skipped} skipped
        </Badge>
      )}
      {result.errors > 0 && (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {result.errors} errors
        </Badge>
      )}
      {result.ingested > 0 && (
        <>
          <Badge variant="outline" className="gap-1 font-mono">
            gross ${result.totalGross.toFixed(2)}
          </Badge>
          <Badge variant="outline" className="gap-1 font-mono text-muted-foreground">
            fee ${result.totalFee.toFixed(2)}
          </Badge>
        </>
      )}
    </div>
  );
}

function AppSyncRow({
  appId,
  appName,
  store,
  month,
  syncState,
  onSync,
}: {
  appId: string;
  appName: string;
  store: "app-store" | "play-store";
  month: string;
  syncState: SyncState;
  onSync: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{appName}</p>
          <p className="text-xs text-muted-foreground font-mono">{appId}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onSync}
          disabled={syncState.status === "loading"}
          className="shrink-0"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5 mr-1.5", syncState.status === "loading" && "animate-spin")}
          />
          {syncState.status === "loading" ? "Syncing…" : `Sync ${month}`}
        </Button>
      </div>
      {syncState.status === "success" && <ResultBadge result={syncState.result} />}
      {syncState.status === "error" && (
        <Alert variant="destructive" className="py-2 mt-1">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{syncState.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function StoreReports() {
  const [month, setMonth] = useState(prevMonth);
  const { getState, triggerSync } = useSyncState();

  const { data: appleData } = useListAppleSubscriptions();
  const { data: playData } = useListPlaySubscriptions();

  const appleApps = appleData ?? [];
  const playApps = playData ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Store report ingestion</h1>
        <p className="text-muted-foreground mt-1">
          Import subscription revenue from Apple App Store and Google Play into the
          double-entry ledger. Each run is idempotent — re-running the same month is safe.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium whitespace-nowrap">Report month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          max={prevMonth()}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Apple className="h-4 w-4" />
            <CardTitle className="text-base">Apple App Store</CardTitle>
          </div>
          <CardDescription>
            Pulls the SUBSCRIPTION_EVENT monthly report from App Store Connect and books each
            renewal as a ledger sale using the actual Apple fee from the report.
            Requires{" "}
            <code className="text-xs bg-muted px-1 rounded">APPLE_VENDOR_NUMBER</code>{" "}
            plus the existing Apple API credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appleApps.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                No tracked iOS apps found. Add an{" "}
                <code className="text-xs bg-muted px-1 rounded">iosBundle</code> to an app in the
                APPS inventory to enable App Store ingestion.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="divide-y">
              {appleApps.map((app) => (
                <AppSyncRow
                  key={app.appId}
                  appId={app.appId}
                  appName={app.appName}
                  store="app-store"
                  month={month}
                  syncState={getState(`app-store:${app.appId}`)}
                  onSync={() => triggerSync(app.appId, "app-store", month)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            <CardTitle className="text-base">Google Play</CardTitle>
          </div>
          <CardDescription>
            Pulls the earnings CSV from the Play Console GCS bucket and books each charge,
            reconstructing gross from the 15% net-proceeds. Requires Workload Identity
            Federation credentials plus{" "}
            <code className="text-xs bg-muted px-1 rounded">GOOGLE_PLAY_REPORTING_BUCKET</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {playApps.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                No tracked Android apps found. Add an{" "}
                <code className="text-xs bg-muted px-1 rounded">androidPackage</code> to an app in
                the APPS inventory to enable Play ingestion.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="divide-y">
              {playApps.map((app) => (
                <AppSyncRow
                  key={app.appId}
                  appId={app.appId}
                  appName={app.appName}
                  store="play-store"
                  month={month}
                  syncState={getState(`play-store:${app.appId}`)}
                  onSync={() => triggerSync(app.appId, "play-store", month)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">How it works:</span> Each sync pulls the
          raw report for the selected month, skips non-revenue rows (trials, cancellations) and
          non-USD sales, then writes a two-leg journal entry per sale: gross revenue recognized +
          store fee expensed. Results land in the app's ledger immediately.
        </p>
        <p>
          <span className="font-medium text-foreground">Idempotency:</span> The store's native
          transaction ID is used as the idempotency key. Re-running the same month is safe —
          already-recorded sales are counted as <em>skipped</em>, not duplicated.
        </p>
      </div>
    </div>
  );
}
