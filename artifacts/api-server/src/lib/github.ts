import { logger } from "./logger.js";

/**
 * GitHub Actions deployment history.
 *
 * Fetches the last 50 workflow runs for a given repo under the Kinisis-Labs org.
 * Returns [] immediately when GITHUB_TOKEN is absent — the deployments page
 * renders an empty state in that case.
 *
 * Cache: 5 minutes in-process.
 */

const GITHUB_ORG = "Kinisis-Labs";
const CACHE_TTL_MS = 5 * 60 * 1000;

export type GitHubDeployment = {
  id: string;
  appId: string;
  appName: string;
  environment: string;
  version: string;
  status: "Succeeded" | "Failed" | "InProgress" | "RolledBack";
  triggeredBy: string;
  startedAt: string;
  durationSec: number | null;
  commitSha: string;
  pipeline: string;
  runType: "deploy" | "ci";
  runUrl: string;
};

const DEPLOY_WORKFLOW_PATTERN = /deploy|release|publish/i;

type CacheEntry = {
  data: GitHubDeployment[];
  fetchedAt: number;
};

const _cache = new Map<string, CacheEntry>();

function isConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function mapRunStatus(
  status: string,
  conclusion: string | null,
): GitHubDeployment["status"] {
  if (status === "in_progress" || status === "queued" || status === "waiting") {
    return "InProgress";
  }
  if (status === "completed") {
    if (conclusion === "success") return "Succeeded";
    if (conclusion === "cancelled") return "RolledBack";
    return "Failed";
  }
  return "InProgress";
}

async function fetchRunsFromGitHub(
  appId: string,
  appName: string,
  appRepo: string,
  environment: string,
): Promise<GitHubDeployment[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];

  const url = `https://api.github.com/repos/${GITHUB_ORG}/${appRepo}/actions/runs?per_page=50`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!resp.ok) {
    logger.warn({ status: resp.status, repo: appRepo }, "GitHub Actions API error");
    return [];
  }

  const json = (await resp.json()) as {
    workflow_runs: Array<{
      id: number;
      run_number: number;
      name: string;
      head_sha: string;
      status: string;
      conclusion: string | null;
      created_at: string;
      updated_at: string;
      actor: { login: string } | null;
    }>;
  };

  return (json.workflow_runs ?? []).map((run) => {
    const startedAt = run.created_at;
    const endedAt = run.updated_at;
    const durationSec =
      run.status === "completed"
        ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
        : null;

    const workflowName = run.name ?? appRepo;
    return {
      id: String(run.id),
      appId,
      appName,
      environment,
      version: `#${run.run_number}`,
      status: mapRunStatus(run.status, run.conclusion),
      triggeredBy: run.actor?.login ?? "github-actions",
      startedAt,
      durationSec,
      commitSha: run.head_sha.slice(0, 7),
      pipeline: workflowName,
      runType: DEPLOY_WORKFLOW_PATTERN.test(workflowName) ? "deploy" : "ci",
      runUrl: `https://github.com/${GITHUB_ORG}/${appRepo}/actions/runs/${run.id}`,
    };
  });
}

export type FetchDeploymentsResult = {
  runs: GitHubDeployment[];
  fetchedAt: string | null;
  dataSource: "live" | "mock";
};

export async function fetchDeployments(
  appId: string,
  appName: string,
  appRepo: string | undefined | null,
  environment: string,
): Promise<FetchDeploymentsResult> {
  if (!isConfigured() || !appRepo) {
    return { runs: [], fetchedAt: null, dataSource: "mock" };
  }

  const cacheKey = `${appId}:${appRepo}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { runs: cached.data, fetchedAt: new Date(cached.fetchedAt).toISOString(), dataSource: "live" };
  }

  try {
    const data = await fetchRunsFromGitHub(appId, appName, appRepo, environment);
    const now = Date.now();
    _cache.set(cacheKey, { data, fetchedAt: now });
    return { runs: data, fetchedAt: new Date(now).toISOString(), dataSource: "live" };
  } catch (err) {
    logger.error({ err, appRepo }, "fetchDeployments error");
    return { runs: [], fetchedAt: null, dataSource: "mock" };
  }
}
