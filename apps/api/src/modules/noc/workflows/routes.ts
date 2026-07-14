import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../../../middlewares/auth.js";
import { logger } from "../../../lib/logger.js";

const router: IRouter = Router();

const CACHE_TTL_MS = 2 * 60 * 1000;
let cachedSnapshot: WorkflowSnapshot | null = null;
let cacheExpiresAt = 0;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: number;
  name: string;
  workflow: string;
  branch: string;
  status: "completed" | "in_progress" | "queued" | "waiting" | "action_required" | "cancelled" | "failure" | "skipped";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
  durationMs: number | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  url: string;
  repo: string;
}

export interface WorkflowSummary {
  workflow: string;
  repo: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgDurationMs: number | null;
  lastRunAt: string | null;
  lastConclusion: string | null;
  health: "healthy" | "degraded" | "critical" | "unknown";
}

export interface WorkflowSnapshot {
  recentRuns: WorkflowRun[];
  summaries: WorkflowSummary[];
  totalRuns24h: number;
  failedRuns24h: number;
  inProgressRuns: number;
  githubConfigured: boolean;
  capturedAt: string;
}

// ── GitHub API helpers ─────────────────────────────────────────────────────────

function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
}

function isGithubConfigured(): boolean {
  return !!(getGithubToken() && process.env.GITHUB_ORG);
}

async function ghFetch(path: string): Promise<unknown> {
  const token = getGithubToken();
  if (!token) return null;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    logger.warn({ status: res.status, path, body: txt.slice(0, 200) }, "GitHub API call failed");
    return null;
  }
  return res.json();
}

function deriveHealth(summary: Omit<WorkflowSummary, "health">): WorkflowSummary["health"] {
  if (summary.totalRuns === 0) return "unknown";
  const rate = summary.successRate ?? 0;
  if (rate < 50) return "critical";
  if (rate < 80) return "degraded";
  return "healthy";
}

async function fetchWorkflowRuns(org: string, repo: string): Promise<WorkflowRun[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const data = await ghFetch(`/repos/${org}/${repo}/actions/runs?per_page=50&created=>=${since}`) as {
    workflow_runs?: Array<{
      id: number;
      name: string;
      display_title: string;
      head_branch: string;
      status: string;
      conclusion: string | null;
      run_started_at: string | null;
      updated_at: string;
      html_url: string;
      triggering_actor?: { login: string };
      path?: string;
    }>;
  } | null;

  if (!data?.workflow_runs) return [];

  return data.workflow_runs.map((r) => {
    const startedAt = r.run_started_at ?? r.updated_at;
    const completedAt = r.status === "completed" ? r.updated_at : null;
    const durationMs =
      r.status === "completed" && startedAt && completedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : null;
    return {
      id: r.id,
      name: r.display_title || r.name || "Unknown",
      workflow: r.name || "Unknown",
      branch: r.head_branch ?? "unknown",
      status: (r.status as WorkflowRun["status"]) ?? "completed",
      conclusion: (r.conclusion as WorkflowRun["conclusion"]) ?? null,
      durationMs,
      triggeredBy: r.triggering_actor?.login ?? "unknown",
      startedAt,
      completedAt,
      url: r.html_url,
      repo,
    };
  });
}

function buildSummaries(runs: WorkflowRun[]): WorkflowSummary[] {
  const byWorkflow = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const key = `${run.repo}::${run.workflow}`;
    const existing = byWorkflow.get(key) ?? [];
    existing.push(run);
    byWorkflow.set(key, existing);
  }

  return Array.from(byWorkflow.entries()).map(([, wRuns]) => {
    const completed = wRuns.filter((r) => r.status === "completed");
    const successCount = completed.filter((r) => r.conclusion === "success").length;
    const failureCount = completed.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length;
    const successRate = completed.length > 0 ? Math.round((successCount / completed.length) * 100) : null;
    const durations = wRuns.map((r) => r.durationMs).filter((d): d is number => d !== null);
    const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const sorted = [...wRuns].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const last = sorted[0];
    const base = {
      workflow: last?.workflow ?? "Unknown",
      repo: last?.repo ?? "Unknown",
      totalRuns: wRuns.length,
      successCount,
      failureCount,
      successRate,
      avgDurationMs,
      lastRunAt: last?.startedAt ?? null,
      lastConclusion: last?.conclusion ?? last?.status ?? null,
    };
    return { ...base, health: deriveHealth(base) };
  }).sort((a, b) => (b.failureCount - a.failureCount) || (a.workflow.localeCompare(b.workflow)));
}

// ── Route ──────────────────────────────────────────────────────────────────────

router.get("/workflows", requireAuth, requireAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";
    const now = Date.now();

    if (!forceRefresh && cachedSnapshot && now < cacheExpiresAt) {
      res.json(cachedSnapshot);
      return;
    }

    const githubConfigured = isGithubConfigured();

    if (!githubConfigured) {
      const empty: WorkflowSnapshot = {
        recentRuns: [],
        summaries: [],
        totalRuns24h: 0,
        failedRuns24h: 0,
        inProgressRuns: 0,
        githubConfigured: false,
        capturedAt: new Date().toISOString(),
      };
      res.json(empty);
      return;
    }

    const org = process.env.GITHUB_ORG!;
    const reposEnv = process.env.GITHUB_REPOS ?? org;
    const repos = reposEnv.split(",").map((r) => r.trim()).filter(Boolean);

    const allRuns = (await Promise.all(repos.map((repo) => fetchWorkflowRuns(org, repo)))).flat();
    allRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const summaries = buildSummaries(allRuns);
    const totalRuns24h = allRuns.length;
    const failedRuns24h = allRuns.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length;
    const inProgressRuns = allRuns.filter((r) => r.status === "in_progress" || r.status === "queued").length;

    const snapshot: WorkflowSnapshot = {
      recentRuns: allRuns.slice(0, 50),
      summaries,
      totalRuns24h,
      failedRuns24h,
      inProgressRuns,
      githubConfigured: true,
      capturedAt: new Date().toISOString(),
    };

    cachedSnapshot = snapshot;
    cacheExpiresAt = now + CACHE_TTL_MS;

    res.json(snapshot);
  } catch (err) {
    logger.error({ err }, "GET /api/noc/workflows failed");
    res.status(500).json({ error: "Failed to fetch workflow data" });
  }
});

export default router;
