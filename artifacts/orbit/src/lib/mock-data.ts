export function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

export type AppLite = {
  id: string;
  name: string;
  environment: string;
  region: string;
  resourceGroup: string;
  subscriptionId: string;
};

// --- Deployments ----------------------------------------------------------

export type DeploymentStatus = "Succeeded" | "Failed" | "InProgress" | "RolledBack";

export type Deployment = {
  id: string;
  appId: string;
  appName: string;
  environment: string;
  version: string;
  status: DeploymentStatus;
  triggeredBy: string;
  startedAt: string;
  durationSec: number;
  commitSha: string;
  pipeline: string;
};

const DEPLOYERS = [
  "arielle.mendez@kinisis.io",
  "jordan.kim@kinisis.io",
  "morgan.lee@kinisis.io",
  "priya.shah@kinisis.io",
  "tom.becker@kinisis.io",
  "ci-bot@kinisis.io",
];

export function buildDeployments(apps: AppLite[]): Deployment[] {
  const out: Deployment[] = [];
  for (const app of apps) {
    const rand = seededRand(app.id + "deployments");
    const count = 6 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const minorsAgo = i * (30 + Math.floor(rand() * 240));
      const startedAt = new Date(Date.now() - minorsAgo * 60 * 1000).toISOString();
      const statusRoll = rand();
      const status: DeploymentStatus =
        i === 0 && statusRoll < 0.08
          ? "InProgress"
          : statusRoll < 0.08
            ? "Failed"
            : statusRoll < 0.14
              ? "RolledBack"
              : "Succeeded";
      const major = 2 + Math.floor(rand() * 3);
      const minor = Math.floor(rand() * 12);
      const patch = Math.floor(rand() * 40);
      out.push({
        id: `${app.id}-dep-${i}`,
        appId: app.id,
        appName: app.name,
        environment: app.environment,
        version: `v${major}.${minor}.${patch}`,
        status,
        triggeredBy: pick(rand, DEPLOYERS),
        startedAt,
        durationSec: 90 + Math.floor(rand() * 540),
        commitSha: Math.floor(rand() * 0xfffffff).toString(16).padStart(7, "0"),
        pipeline: `${app.id}-cd`,
      });
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// --- Activity log ---------------------------------------------------------

export type ActivityEntry = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  appId?: string;
  status: "Succeeded" | "Failed" | "Started";
  category: "Authorization" | "Configuration" | "Operation" | "Cost" | "Security";
};

const ACTION_TEMPLATES: Array<{
  action: string;
  category: ActivityEntry["category"];
  target: (appId: string, app: string) => string;
}> = [
  { action: "Restart Container App", category: "Operation", target: (id) => `ca-${id}-api` },
  { action: "Update App Configuration", category: "Configuration", target: (id) => `appcs-${id}` },
  { action: "Scale Container App", category: "Operation", target: (id) => `ca-${id}-api` },
  { action: "Acknowledge alert", category: "Operation", target: (id) => `${id}-alert-1` },
  { action: "Rotate Key Vault secret", category: "Security", target: (id) => `kv-${id}/db-password` },
  { action: "Modify budget", category: "Cost", target: (id) => `budget-${id}-monthly` },
  { action: "Grant role assignment", category: "Authorization", target: (_id, app) => `Reader on ${app}` },
  { action: "Disable diagnostic setting", category: "Configuration", target: (id) => `diag-${id}` },
  { action: "Deploy revision", category: "Operation", target: (id) => `ca-${id}-api` },
  { action: "Query cost export", category: "Cost", target: (id) => `export-${id}-monthly` },
];

export function buildActivity(apps: AppLite[], limit = 80): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const app of apps) {
    const rand = seededRand(app.id + "activity");
    const n = 8 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const tpl = ACTION_TEMPLATES[Math.floor(rand() * ACTION_TEMPLATES.length)]!;
      const minsAgo = Math.floor(rand() * 60 * 24 * 5) + 1;
      const statusRoll = rand();
      const status: ActivityEntry["status"] =
        statusRoll < 0.85 ? "Succeeded" : statusRoll < 0.93 ? "Started" : "Failed";
      out.push({
        id: `${app.id}-act-${i}`,
        timestamp: new Date(Date.now() - minsAgo * 60 * 1000).toISOString(),
        actor: pick(rand, DEPLOYERS),
        action: tpl.action,
        target: tpl.target(app.id, app.name),
        appId: app.id,
        status,
        category: tpl.category,
      });
    }
  }
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

// --- SLO / Health ---------------------------------------------------------

export type SloRow = {
  appId: string;
  appName: string;
  environment: string;
  uptimePct: number;
  errorBudgetRemainingPct: number;
  p95LatencyMs: number;
  p95TargetMs: number;
  errorRatePct: number;
  errorTargetPct: number;
};

export function buildSlos(apps: AppLite[]): SloRow[] {
  return apps.map((app) => {
    const rand = seededRand(app.id + "slo");
    const uptime = 99.0 + rand() * 0.99;
    const burn = rand();
    return {
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      uptimePct: Number(uptime.toFixed(3)),
      errorBudgetRemainingPct: Number((100 * (1 - burn * 0.9)).toFixed(1)),
      p95LatencyMs: Math.floor(150 + rand() * 700),
      p95TargetMs: 500,
      errorRatePct: Number((rand() * 2.5).toFixed(2)),
      errorTargetPct: 1.0,
    };
  });
}

// --- Cross-app endpoints --------------------------------------------------

export type EndpointRow = {
  id: string;
  appId: string;
  appName: string;
  name: string;
  url: string;
  region: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  packetLossPct: number;
  uptimePct: number;
};

export function buildEndpoints(apps: AppLite[]): EndpointRow[] {
  const out: EndpointRow[] = [];
  for (const app of apps) {
    const rand = seededRand(app.id + "endpoints");
    const eps = [
      { name: "Front Door (public)", host: `${app.id}.kinisis.io` },
      { name: "Origin (internal)", host: `${app.id}-origin.privatelink.azurewebsites.net` },
      { name: "Health probe", host: `${app.id}.kinisis.io/healthz` },
    ];
    eps.forEach((ep, i) => {
      const statusRoll = rand();
      const status: EndpointRow["status"] =
        statusRoll < 0.1 ? "unhealthy" : statusRoll < 0.25 ? "degraded" : "healthy";
      out.push({
        id: `${app.id}-ep-${i}`,
        appId: app.id,
        appName: app.name,
        name: ep.name,
        url: `https://${ep.host}`,
        region: app.region,
        status,
        latencyMs: Math.floor(8 + rand() * 240),
        packetLossPct: Number((rand() * 0.6).toFixed(2)),
        uptimePct: Number((99.0 + rand() * 0.99).toFixed(3)),
      });
    });
  }
  return out;
}

// --- Log search (KQL preview) --------------------------------------------

export type LogLine = {
  id: string;
  timestamp: string;
  appId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
};

const LOG_TEMPLATES = [
  { level: "INFO", message: "Request completed in {ms}ms" },
  { level: "INFO", message: "Cache hit for key user:{n}" },
  { level: "WARN", message: "Slow SQL query: SELECT ... took {ms}ms" },
  { level: "WARN", message: "Retrying upstream call (attempt {n}/3)" },
  { level: "ERROR", message: "Unhandled exception: NullReferenceException at line {n}" },
  { level: "INFO", message: "Health probe OK ({ms}ms)" },
  { level: "ERROR", message: "Failed to acquire DB connection from pool after {ms}ms" },
] as const;

export function buildLogs(apps: AppLite[], query: string, limit = 50): LogLine[] {
  const out: LogLine[] = [];
  for (const app of apps) {
    const rand = seededRand(app.id + "logs" + query);
    const n = 6 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const tpl = LOG_TEMPLATES[Math.floor(rand() * LOG_TEMPLATES.length)]!;
      const ms = 5 + Math.floor(rand() * 1500);
      const num = Math.floor(rand() * 9999);
      out.push({
        id: `${app.id}-log-${i}`,
        timestamp: new Date(Date.now() - Math.floor(rand() * 60 * 60 * 1000)).toISOString(),
        appId: app.id,
        level: tpl.level,
        message: tpl.message.replace("{ms}", String(ms)).replace("{n}", String(num)),
      });
    }
  }
  const filtered = query.trim()
    ? out.filter((l) => l.message.toLowerCase().includes(query.toLowerCase()) || l.appId.toLowerCase().includes(query.toLowerCase()))
    : out;
  return filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

// --- Azure service health -------------------------------------------------

export type ServiceHealthEvent = {
  id: string;
  service: string;
  region: string;
  status: "Active" | "Resolved" | "Advisory";
  severity: "Low" | "Medium" | "High";
  title: string;
  startedAt: string;
  resolvedAt?: string;
};

const REGIONS = ["eastus2", "centralus", "westus2", "northeurope", "global"];
const SERVICES = [
  "Azure SQL Database",
  "Container Apps",
  "Azure Front Door",
  "Application Insights",
  "Azure Monitor",
  "Key Vault",
];

export function buildServiceHealth(): ServiceHealthEvent[] {
  const rand = seededRand("svc-health-static-v2");
  const events: ServiceHealthEvent[] = [];
  const titles = [
    "Increased latency observed",
    "Investigating intermittent 5xx errors",
    "Planned maintenance window",
    "Mitigated - all systems nominal",
    "Advisory: TLS 1.0/1.1 retirement",
  ];
  for (let i = 0; i < 6; i++) {
    const isResolved = i > 2;
    events.push({
      id: `svc-evt-${i}`,
      service: pick(rand, SERVICES),
      region: pick(rand, REGIONS),
      status: isResolved ? "Resolved" : i === 2 ? "Advisory" : "Active",
      severity: pick(rand, ["Low", "Medium", "High"] as const),
      title: pick(rand, titles),
      startedAt: new Date(Date.now() - (i + 1) * 3 * 60 * 60 * 1000).toISOString(),
      resolvedAt: isResolved ? new Date(Date.now() - i * 60 * 60 * 1000).toISOString() : undefined,
    });
  }
  return events;
}

// --- Subscriptions --------------------------------------------------------

export type SubscriptionRow = {
  id: string;
  name: string;
  appCount: number;
  apps: string[];
  monthToDateCost: number;
  state: "Enabled";
  ownerTeam: string;
};

const SUB_META: Record<string, { name: string; team: string }> = {
  "a1f4-shared-platform": { name: "Shared Platform", team: "Platform Engineering" },
  "b203-internal-tools": { name: "Internal Tools", team: "Platform Engineering" },
  "c508-finance": { name: "Finance Services", team: "Finance Engineering" },
};

export function buildSubscriptions(
  apps: Array<AppLite & { monthToDateCost: number; name: string }>,
): SubscriptionRow[] {
  const map = new Map<string, SubscriptionRow>();
  for (const app of apps) {
    const meta = SUB_META[app.subscriptionId] ?? { name: app.subscriptionId, team: "Unassigned" };
    const existing = map.get(app.subscriptionId);
    if (existing) {
      existing.appCount += 1;
      existing.apps.push(app.name);
      existing.monthToDateCost += app.monthToDateCost;
    } else {
      map.set(app.subscriptionId, {
        id: app.subscriptionId,
        name: meta.name,
        appCount: 1,
        apps: [app.name],
        monthToDateCost: app.monthToDateCost,
        state: "Enabled",
        ownerTeam: meta.team,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.monthToDateCost - a.monthToDateCost);
}

// --- Tags -----------------------------------------------------------------

export type TagRow = {
  key: string;
  value: string;
  appCount: number;
  apps: string[];
};

export function buildTags(apps: Array<AppLite & { tags?: Record<string, string>; name: string }>): TagRow[] {
  const map = new Map<string, TagRow>();
  for (const app of apps) {
    for (const [k, v] of Object.entries(app.tags || {})) {
      const key = `${k}=${v}`;
      const existing = map.get(key);
      if (existing) {
        existing.appCount += 1;
        existing.apps.push(app.name);
      } else {
        map.set(key, { key: k, value: v, appCount: 1, apps: [app.name] });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));
}

// --- Budgets / Forecasts (cost sub-pages) --------------------------------

export type BudgetRow = {
  appId: string;
  appName: string;
  environment: string;
  budget: number;
  spent: number;
  forecast: number;
  status: "Healthy" | "Warning" | "Breach";
};

export function buildBudgets(apps: Array<AppLite & { monthToDateCost: number; name: string }>): BudgetRow[] {
  return apps.map((app) => {
    const rand = seededRand(app.id + "budget");
    const budget = Math.max(500, Math.round(app.monthToDateCost * (1.4 + rand() * 0.5)));
    const forecast = Math.round(app.monthToDateCost * (1.7 + rand() * 0.6));
    const ratio = forecast / budget;
    const status: BudgetRow["status"] = ratio > 1 ? "Breach" : ratio > 0.85 ? "Warning" : "Healthy";
    return {
      appId: app.id,
      appName: app.name,
      environment: app.environment,
      budget,
      spent: app.monthToDateCost,
      forecast,
      status,
    };
  });
}
