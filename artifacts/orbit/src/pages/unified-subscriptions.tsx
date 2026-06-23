import { useMemo } from "react";
import {
  useListAppleSubscriptions,
  useListPlaySubscriptions,
  useListStripeSubscriptions,
} from "@workspace/api-client-react";
import { useUpdatedAgo } from "@/hooks/use-updated-ago";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingDown,
  TrendingUp,
  ExternalLink,
  Clock,
  AlertTriangle,
  PowerOff,
  Smartphone,
  Apple,
  CreditCard,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useCsvExport } from "@/hooks/use-csv-export";
import { useToast } from "@/hooks/use-toast";
import { CsvToolbar } from "@/components/csv-toolbar";
import { format } from "date-fns";
import { StaleCacheBanner } from "@/components/stale-cache-banner";
import { AdminAccessBadge } from "@/components/admin-access-badge";
import { DataSourceBadge } from "@/components/data-source-badge";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface SubscriptionRow {
  appId: string;
  appName: string;
  environment: string;
  storeType: "apple" | "play" | "stripe";
  identifier: string; // bundleId, packageName, or appId for Stripe
  activeSubscribers: number;
  canceledSubscribers: number;
  expiredSubscribers: number;
  trialingSubscribers?: number; // Stripe only
  pastDueSubscribers?: number; // Stripe only
  mrr: number;
  revenueLast30d: number;
  currency: string;
  activeTrendPct: number;
  dataSource: "live" | "cached";
  dataAsOf?: string;
  managementUrl?: string;
}

interface StoreSection {
  storeType: "apple" | "play" | "stripe";
  title: string;
  icon: React.ReactNode;
  data: SubscriptionRow[];
  totals: {
    active: number;
    canceled: number;
    expired: number;
    trialing?: number; // Stripe only
    pastDue?: number; // Stripe only
    mrr: number;
    revenue: number;
  };
  isLive: boolean;
  isCached: boolean;
  badgeDataSource?: "live" | "cached";
  staleCachedRow?: SubscriptionRow;
  earliestDataAsOf?: string;
  dataUpdatedAt?: number;
  isError?: boolean;
  error?: { status?: number } | null;
}

export default function UnifiedSubscriptions() {
  const { toast } = useToast();

  const {
    data: appleData,
    isLoading: appleLoading,
    isError: appleError,
    error: appleErrorObj,
    dataUpdatedAt: appleDataUpdatedAt,
  } = useListAppleSubscriptions();

  const {
    data: playData,
    isLoading: playLoading,
    isError: playError,
    error: playErrorObj,
    dataUpdatedAt: playDataUpdatedAt,
  } = useListPlaySubscriptions();

  const {
    data: stripeData,
    isLoading: stripeLoading,
    isError: stripeError,
    error: stripeErrorObj,
    dataUpdatedAt: stripeDataUpdatedAt,
  } = useListStripeSubscriptions();

  const isAppleDisabled =
    appleError && (appleErrorObj as { status?: number } | null)?.status === 404;
  const isPlayDisabled = playError && (playErrorObj as { status?: number } | null)?.status === 404;
  const isStripeDisabled =
    stripeError && (stripeErrorObj as { status?: number } | null)?.status === 404;

  // Transform Apple data
  const appleRows = useMemo(() => {
    if (!appleData) return [];
    return appleData
      .filter((row) => row.dataSource !== "placeholder")
      .map(
        (row): SubscriptionRow => ({
          appId: row.appId,
          appName: row.appName,
          environment: row.environment,
          storeType: "apple",
          identifier: row.bundleId,
          activeSubscribers: row.activeSubscribers,
          canceledSubscribers: row.canceledSubscribers,
          expiredSubscribers: row.expiredSubscribers,
          mrr: row.mrr,
          revenueLast30d: row.revenueLast30d,
          currency: row.currency,
          activeTrendPct: row.activeTrendPct,
          dataSource: row.dataSource as "live" | "cached",
          dataAsOf: row.dataAsOf,
          managementUrl: row.appleAppId
            ? `https://appstoreconnect.apple.com/apps/${row.appleAppId}/distribution/subscriptions`
            : undefined,
        }),
      );
  }, [appleData]);

  // Transform Play data
  const playRows = useMemo(() => {
    if (!playData) return [];
    return playData
      .filter((row) => row.dataSource !== "placeholder")
      .map(
        (row): SubscriptionRow => ({
          appId: row.appId,
          appName: row.appName,
          environment: row.environment,
          storeType: "play",
          identifier: row.packageName,
          activeSubscribers: row.activeSubscribers,
          canceledSubscribers: row.canceledSubscribers,
          expiredSubscribers: row.expiredSubscribers,
          mrr: row.mrr,
          revenueLast30d: row.revenueLast30d,
          currency: row.currency,
          activeTrendPct: row.activeTrendPct,
          dataSource: row.dataSource as "live" | "cached",
          dataAsOf: row.dataAsOf,
          managementUrl:
            row.playAppId && row.playDeveloperId
              ? `https://play.google.com/console/developers/${row.playDeveloperId}/app/${row.playAppId}/subscriptions`
              : undefined,
        }),
      );
  }, [playData]);

  // Transform Stripe data
  const stripeRows = useMemo(() => {
    if (!stripeData) return [];
    return stripeData.map(
      (row): SubscriptionRow => ({
        appId: row.appId,
        appName: row.appName,
        environment: row.environment,
        storeType: "stripe",
        identifier: row.appId, // Use appId as identifier for Stripe
        activeSubscribers: row.activeSubscribers,
        canceledSubscribers: row.canceledSubscribers,
        expiredSubscribers: 0, // Stripe doesn't have expired, only canceled
        trialingSubscribers: row.trialingSubscribers,
        pastDueSubscribers: row.pastDueSubscribers,
        mrr: row.mrr,
        revenueLast30d: row.revenueLast30d,
        currency: row.currency,
        activeTrendPct: row.activeTrendPct,
        dataSource: row.dataSource as "live" | "cached",
        dataAsOf: row.dataAsOf,
        managementUrl: row.stripeDashboardUrl,
      }),
    );
  }, [stripeData]);

  // Use all data since we're not filtering by scope
  const appleDataToShow = appleRows;
  const playDataToShow = playRows;
  const stripeDataToShow = stripeRows;

  // Calculate totals for each store
  const appleTotals = appleDataToShow.reduce(
    (acc, r) => ({
      active: acc.active + r.activeSubscribers,
      canceled: acc.canceled + r.canceledSubscribers,
      expired: acc.expired + r.expiredSubscribers,
      mrr: acc.mrr + r.mrr,
      revenue: acc.revenue + r.revenueLast30d,
    }),
    { active: 0, canceled: 0, expired: 0, mrr: 0, revenue: 0 },
  );

  const playTotals = playDataToShow.reduce(
    (acc, r) => ({
      active: acc.active + r.activeSubscribers,
      canceled: acc.canceled + r.canceledSubscribers,
      expired: acc.expired + r.expiredSubscribers,
      mrr: acc.mrr + r.mrr,
      revenue: acc.revenue + r.revenueLast30d,
    }),
    { active: 0, canceled: 0, expired: 0, mrr: 0, revenue: 0 },
  );

  const stripeTotals = stripeDataToShow.reduce(
    (acc, r) => ({
      active: acc.active + r.activeSubscribers,
      canceled: acc.canceled + r.canceledSubscribers,
      expired: acc.expired + r.expiredSubscribers,
      trialing: (acc.trialing || 0) + (r.trialingSubscribers || 0),
      pastDue: (acc.pastDue || 0) + (r.pastDueSubscribers || 0),
      mrr: acc.mrr + r.mrr,
      revenue: acc.revenue + r.revenueLast30d,
    }),
    { active: 0, canceled: 0, expired: 0, trialing: 0, pastDue: 0, mrr: 0, revenue: 0 },
  );

  // Store sections data
  const storeSections: StoreSection[] = [];

  if (!isAppleDisabled) {
    const appleIsLive = appleDataToShow.some((r) => r.dataSource === "live");
    const appleIsCached = appleDataToShow.some((r) => r.dataSource === "cached");
    const appleBadgeDataSource =
      appleDataToShow.length === 0
        ? undefined
        : appleIsLive
          ? "live"
          : appleIsCached
            ? "cached"
            : undefined;

    const appleStaleCachedRow = (() => {
      const cached = appleDataToShow.filter((r) => r.dataSource === "cached" && !!r.dataAsOf);
      if (cached.length === 0) return undefined;
      return cached.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      );
    })();

    const appleEarliestDataAsOf = (() => {
      const withDate = appleDataToShow.filter((r) => !!r.dataAsOf);
      if (withDate.length === 0) return undefined;
      return withDate.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      ).dataAsOf;
    })();

    storeSections.push({
      storeType: "apple",
      title: "App Store",
      icon: <Apple className="h-4 w-4" />,
      data: appleDataToShow,
      totals: appleTotals,
      isLive: appleIsLive,
      isCached: appleIsCached,
      badgeDataSource: appleBadgeDataSource,
      staleCachedRow: appleStaleCachedRow,
      earliestDataAsOf: appleEarliestDataAsOf,
      dataUpdatedAt: appleDataUpdatedAt,
      isError: appleError,
      error: appleErrorObj,
    });
  }

  if (!isPlayDisabled) {
    const playIsLive = playDataToShow.some((r) => r.dataSource === "live");
    const playIsCached = playDataToShow.some((r) => r.dataSource === "cached");
    const playBadgeDataSource =
      playDataToShow.length === 0
        ? undefined
        : playIsLive
          ? "live"
          : playIsCached
            ? "cached"
            : undefined;

    const playStaleCachedRow = (() => {
      const cached = playDataToShow.filter((r) => r.dataSource === "cached" && !!r.dataAsOf);
      if (cached.length === 0) return undefined;
      return cached.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      );
    })();

    const playEarliestDataAsOf = (() => {
      const withDate = playDataToShow.filter((r) => !!r.dataAsOf);
      if (withDate.length === 0) return undefined;
      return withDate.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      ).dataAsOf;
    })();

    storeSections.push({
      storeType: "play",
      title: "Google Play",
      icon: <Smartphone className="h-4 w-4" />,
      data: playDataToShow,
      totals: playTotals,
      isLive: playIsLive,
      isCached: playIsCached,
      badgeDataSource: playBadgeDataSource,
      staleCachedRow: playStaleCachedRow,
      earliestDataAsOf: playEarliestDataAsOf,
      dataUpdatedAt: playDataUpdatedAt,
      isError: playError,
      error: playErrorObj,
    });
  }

  if (!isStripeDisabled) {
    const stripeIsLive = stripeDataToShow.some((r) => r.dataSource === "live");
    const stripeIsCached = stripeDataToShow.some((r) => r.dataSource === "cached");
    const stripeBadgeDataSource =
      stripeDataToShow.length === 0
        ? undefined
        : stripeIsLive
          ? "live"
          : stripeIsCached
            ? "cached"
            : undefined;

    const stripeStaleCachedRow = (() => {
      const cached = stripeDataToShow.filter((r) => r.dataSource === "cached" && !!r.dataAsOf);
      if (cached.length === 0) return undefined;
      return cached.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      );
    })();

    const stripeEarliestDataAsOf = (() => {
      const withDate = stripeDataToShow.filter((r) => !!r.dataAsOf);
      if (withDate.length === 0) return undefined;
      return withDate.reduce((oldest, r) =>
        new Date(r.dataAsOf!).getTime() < new Date(oldest.dataAsOf!).getTime() ? r : oldest,
      ).dataAsOf;
    })();

    storeSections.push({
      storeType: "stripe",
      title: "Stripe",
      icon: <CreditCard className="h-4 w-4" />,
      data: stripeDataToShow,
      totals: stripeTotals,
      isLive: stripeIsLive,
      isCached: stripeIsCached,
      badgeDataSource: stripeBadgeDataSource,
      staleCachedRow: stripeStaleCachedRow,
      earliestDataAsOf: stripeEarliestDataAsOf,
      dataUpdatedAt: stripeDataUpdatedAt,
      isError: stripeError,
      error: stripeErrorObj,
    });
  }

  const isLoading = appleLoading || playLoading || stripeLoading;
  const allData = [...appleDataToShow, ...playDataToShow, ...stripeDataToShow];

  // Debug logging to understand data issues
  console.log("Unified Subscriptions Debug:", {
    appleData: appleData?.length ?? 0,
    playData: playData?.length ?? 0,
    stripeData: stripeData?.length ?? 0,
    appleDataToShow: appleDataToShow.length,
    playDataToShow: playDataToShow.length,
    stripeDataToShow: stripeDataToShow.length,
    allDataLength: allData.length,
    isLoading,
    appleError,
    playError,
    stripeError,
  });
  const overallTotals = allData.reduce(
    (acc, r) => ({
      active: acc.active + r.activeSubscribers,
      canceled: acc.canceled + r.canceledSubscribers,
      expired: acc.expired + r.expiredSubscribers,
      trialing: (acc.trialing || 0) + (r.trialingSubscribers || 0),
      pastDue: (acc.pastDue || 0) + (r.pastDueSubscribers || 0),
      mrr: acc.mrr + r.mrr,
      revenue: acc.revenue + r.revenueLast30d,
    }),
    { active: 0, canceled: 0, expired: 0, trialing: 0, pastDue: 0, mrr: 0, revenue: 0 },
  );

  // CSV export for combined data
  const csvRows = allData.map((r) => [
    r.appName,
    r.storeType === "apple" ? "App Store" : r.storeType === "play" ? "Google Play" : "Stripe",
    r.identifier,
    r.environment,
    String(r.activeSubscribers),
    String(r.canceledSubscribers),
    String(r.expiredSubscribers),
    String(r.trialingSubscribers || 0),
    String(r.pastDueSubscribers || 0),
    r.mrr.toFixed(2),
    r.revenueLast30d.toFixed(2),
    String(r.activeTrendPct),
  ]);

  const {
    copied,
    disabled: csvDisabled,
    handleExport,
    handleCopy,
  } = useCsvExport(
    csvRows,
    [
      "Application",
      "Store",
      "Identifier",
      "Env",
      "Active",
      "Canceled",
      "Expired",
      "Trialing",
      "Past Due",
      "MRR",
      "Revenue (30d)",
      "Active trend %",
    ],
    `unified-subscriptions-all-apps`,
    () =>
      toast({
        title: "No data to export",
        description: "There are no subscription rows in the current view.",
      }),
  );

  if (isAppleDisabled && isPlayDisabled && isStripeDisabled) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="App Store Subscriptions"
          subtitle="Subscription financials and subscriber states across all app stores."
          right={<AdminAccessBadge />}
        />
        <SurfaceDisabled
          icon="ALL"
          title="All subscription surfaces are disabled"
          description="Apple App Store, Google Play, and Stripe subscription surfaces have been turned off via feature flags in Azure App Configuration. To re-enable them, set the flags back on and redeploy (or wait for the next config refresh)."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="App Store Subscriptions"
        subtitle="Subscription financials and subscriber states across all app stores."
        right={<AdminAccessBadge />}
      />

      {/* Overall summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile
          title="Active subscribers"
          value={isLoading ? null : num(overallTotals.active)}
          sub="Currently paying"
        />
        <Tile
          title="Canceled"
          value={isLoading ? null : num(overallTotals.canceled)}
          sub="Auto-renew off, still in term"
        />
        <Tile
          title="Expired"
          value={isLoading ? null : num(overallTotals.expired)}
          sub="Lapsed / inactive"
        />
        <Tile
          title="MRR"
          value={isLoading ? null : usd(overallTotals.mrr)}
          sub="Monthly recurring revenue"
        />
        <Tile
          title="Revenue (30d)"
          value={isLoading ? null : usd(overallTotals.revenue)}
          sub="Trailing 30 days"
        />
      </div>

      {/* Store-specific sections */}
      <div className="space-y-6">
        {storeSections.map((section) => (
          <StoreSection key={section.storeType} section={section} />
        ))}
      </div>

      {/* Combined table */}
      <div className="bg-card border border-border shadow-sm">
        <div className="flex items-center justify-between p-2 border-b border-border">
          <h2 className="text-sm font-semibold px-2">All subscriptions by application</h2>
          <div className="flex items-center gap-1">
            <CsvToolbar
              handleExport={handleExport}
              handleCopy={handleCopy}
              disabled={csvDisabled}
              copied={copied}
            />
          </div>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : (
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/50 hover:bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 font-semibold text-foreground">Application</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Store</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Identifier</TableHead>
                <TableHead className="h-8 font-semibold text-foreground">Env</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Active
                </TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Canceled
                </TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Expired
                </TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">MRR</TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Revenue (30d)
                </TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Active trend
                </TableHead>
                <TableHead className="h-8 font-semibold text-foreground text-right">
                  Manage
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allData.map((r) => {
                const positive = r.activeTrendPct >= 0;
                return (
                  <TableRow
                    key={`${r.storeType}-${r.appId}`}
                    className="h-8 border-b border-border/50 hover:bg-muted/40"
                  >
                    <TableCell className="py-1 font-medium text-primary">{r.appName}</TableCell>
                    <TableCell className="py-1">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px] font-medium ${
                          r.storeType === "apple"
                            ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            : "bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300"
                        }`}
                      >
                        {r.storeType === "apple" ? (
                          <Apple className="h-3 w-3" />
                        ) : (
                          <Smartphone className="h-3 w-3" />
                        )}
                        {r.storeType === "apple" ? "App Store" : "Google Play"}
                      </span>
                    </TableCell>
                    <TableCell className="py-1 font-mono text-[12px]">
                      {r.storeType === "apple" ? (
                        <a
                          href={`https://apps.apple.com/app/${r.identifier}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {r.identifier}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{r.identifier}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-muted-foreground">{r.environment}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      {num(r.activeSubscribers)}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-muted-foreground">
                      {num(r.canceledSubscribers)}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-muted-foreground">
                      {num(r.expiredSubscribers)}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{usd(r.mrr)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      {usd(r.revenueLast30d)}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          positive ? "text-emerald-500" : "text-destructive"
                        }`}
                      >
                        {positive ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {positive ? "+" : ""}
                        {r.activeTrendPct}%
                      </span>
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      {r.managementUrl ? (
                        <a
                          href={r.managementUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary text-[12px] inline-flex items-center gap-1 hover:underline"
                        >
                          Manage <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/40 text-[12px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {allData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-6 text-muted-foreground">
                    No subscription apps found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function StoreSection({ section }: { section: StoreSection }) {
  const {
    dataUpdatedAt,
    earliestDataAsOf,
    isLive,
    staleCachedRow,
    badgeDataSource,
    totals,
    title,
    icon,
  } = section;

  return (
    <div className="space-y-4">
      <StoreBanner
        storeType={section.storeType}
        isLive={isLive}
        dataUpdatedAt={dataUpdatedAt ?? 0}
        dataAsOf={earliestDataAsOf}
      />
      <StaleCacheBanner source={section.storeType} dataAsOf={staleCachedRow?.dataAsOf} />

      <div className="bg-card border border-border shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
          {badgeDataSource && (
            <DataSourceBadge
              dataSource={badgeDataSource}
              dataAsOf={staleCachedRow?.dataAsOf}
              label={title}
            />
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Tile title="Active subscribers" value={num(totals.active)} sub="Currently paying" />
          <Tile title="Canceled" value={num(totals.canceled)} sub="Auto-renew off, still in term" />
          {section.storeType === "stripe" ? (
            <>
              <Tile title="Trialing" value={num(totals.trialing || 0)} sub="Free trial period" />
              <Tile title="Past due" value={num(totals.pastDue || 0)} sub="Payment failed" />
            </>
          ) : (
            <Tile title="Expired" value={num(totals.expired)} sub="Lapsed / inactive" />
          )}
          <Tile title="MRR" value={usd(totals.mrr)} sub="Monthly recurring revenue" />
          <Tile title="Revenue (30d)" value={usd(totals.revenue)} sub="Trailing 30 days" />
        </div>
      </div>
    </div>
  );
}

function StoreBanner({
  storeType,
  isLive,
  dataUpdatedAt,
  dataAsOf,
}: {
  storeType: "apple" | "play" | "stripe";
  isLive: boolean;
  dataUpdatedAt: number;
  dataAsOf?: string;
}) {
  const timestampMs = dataAsOf ? new Date(dataAsOf).getTime() : (dataUpdatedAt ?? 0);
  const ago = useUpdatedAgo(timestampMs);
  const isStale = dataAsOf ? Date.now() - new Date(dataAsOf).getTime() > STALE_THRESHOLD_MS : false;

  const timestampLabel = (() => {
    if (dataAsOf) {
      const d = new Date(dataAsOf);
      const isToday = d.toDateString() === new Date().toDateString();
      const time = d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const label = isToday
        ? time
        : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
      return { text: `Data as of ${label}`, stale: isStale };
    }
    if (dataUpdatedAt) {
      const time = new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return { text: `Fetched at ${time}`, stale: false };
    }
    return null;
  })();

  const storeInfo =
    storeType === "apple"
      ? {
          icon: "AS",
          title: "RevenueCat",
          description:
            "Subscriber states and revenue are pulled live from RevenueCat for each tracked iOS app.",
          url: "https://app.revenuecat.com",
        }
      : storeType === "play"
        ? {
            icon: "GP",
            title: "RevenueCat",
            description:
              "Subscriber states and revenue are pulled live from RevenueCat for each tracked Android app.",
            url: "https://app.revenuecat.com",
          }
        : {
            icon: "ST",
            title: "Stripe",
            description:
              "Subscriber states and revenue are pulled live from Stripe for each tracked web app.",
            url: "https://dashboard.stripe.com",
          };

  return (
    <div className="bg-card border border-border shadow-sm p-3 flex items-start gap-3">
      <div className="shrink-0 h-8 w-8 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">
        {storeInfo.icon}
      </div>
      <div className="flex-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="text-foreground font-semibold">{`${storeInfo.title}–sourced.`}</span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </span>{" "}
        {storeInfo.description}
        {timestampLabel && (
          <span
            className={`inline-flex items-center gap-1 ml-2 ${
              timestampLabel.stale ? "text-amber-500" : "text-muted-foreground/70"
            }`}
          >
            {timestampLabel.stale ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {timestampLabel.text}
            {ago && <span>· {ago}</span>}
          </span>
        )}
      </div>
      <a
        href={storeInfo.url}
        target="_blank"
        rel="noreferrer"
        className="text-primary text-[12px] inline-flex items-center gap-1 hover:underline shrink-0"
      >
        Open {storeInfo.title} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function Tile({ title, value, sub }: { title: string; value: string | null; sub: string }) {
  return (
    <div className="bg-card border border-border p-3 shadow-sm flex flex-col justify-between">
      <div className="text-[12px] text-muted-foreground font-medium mb-1 truncate">{title}</div>
      {value === null ? (
        <Skeleton className="h-7 w-20 mb-1" />
      ) : (
        <div className="text-xl font-semibold tabular-nums mb-1">{value}</div>
      )}
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function SurfaceDisabled({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-card border border-border shadow-sm p-4 flex items-start gap-4">
      <div className="shrink-0 h-10 w-10 rounded-sm bg-muted text-muted-foreground flex items-center justify-center">
        <PowerOff className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="text-[13px] text-muted-foreground mt-1">{description}</p>
        <p className="text-[12px] text-muted-foreground/60 mt-2">
          Surface identifier: <span className="font-mono">{icon.toLowerCase()}-subscriptions</span>
        </p>
      </div>
    </div>
  );
}
