import "./lib/telemetry"; // must be first — patches Node built-ins before any other module loads

// --------------------------------------------------------------------------
// Pre-import diagnostics — written with process.stdout.write so they reach
// the Container App log stream even before the logger module is loaded.
// --------------------------------------------------------------------------
function preLog(msg: string, extra?: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ level: 30, time: Date.now(), pid: process.pid, msg, ...extra }) + "\n",
  );
}

preLog("pre-startup env check", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  ENTRA_TENANT_ID_set: !!process.env.ENTRA_TENANT_ID,
  ENTRA_CLIENT_ID_set: !!process.env.ENTRA_CLIENT_ID,
  ENTRA_CLIENT_SECRET_set: !!process.env.ENTRA_CLIENT_SECRET,
  ENTRA_CLIENT_SECRET_len: (process.env.ENTRA_CLIENT_SECRET ?? "").length,
  ENTRA_REDIRECT_URI_set: !!process.env.ENTRA_REDIRECT_URI,
  SESSION_SECRET_set: !!process.env.SESSION_SECRET,
  DATABASE_URL_set: !!process.env.DATABASE_URL,
  DATABASE_URL_len: (process.env.DATABASE_URL ?? "").length,
  DATABASE_SSL: process.env.DATABASE_SSL,
});

// --------------------------------------------------------------------------
// Dynamic app import — lets us catch any synchronous module-level throw in
// app.ts (e.g. the Entra guard) and log it before exiting.
// --------------------------------------------------------------------------
const rawPort = process.env["PORT"];

if (!rawPort) {
  process.stderr.write("FATAL: PORT environment variable is required but was not provided.\n");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  process.stderr.write(`FATAL: Invalid PORT value: "${rawPort}"\n`);
  process.exit(1);
}

let appModule: { default: import("express").Express };
try {
  appModule = await import("./app.js");
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  process.stdout.write(
    JSON.stringify({
      level: 50,
      time: Date.now(),
      pid: process.pid,
      msg: "STARTUP_CRASH: app.ts module initialization failed",
      error: message,
      stack,
    }) + "\n",
  );
  process.exit(1);
}

const app = appModule.default;

const { logger } = await import("./lib/logger.js");
const { startBudgetAlertScheduler } = await import("./lib/budgetAlerts.js");
const { startCostSnapshotRefresh } = await import("./lib/costSnapshotRefresh.js");
const { startAnomalyDismissalCleanup } = await import("./lib/anomalyDismissalCleanup.js");

function logAzureConfig(): void {
  const ids = process.env.AZURE_SUBSCRIPTION_IDS ?? "";
  logger.info(
    {
      AZURE_SUBSCRIPTION_IDS_set: ids.length > 0,
      AZURE_SUBSCRIPTION_IDS_len: ids.length,
      AZURE_SUBSCRIPTION_IDS_subcount: ids.split(",").filter(Boolean).length,
      AZURE_CLIENT_ID_set: Boolean(process.env.AZURE_CLIENT_ID),
      AZURE_TENANT_ID_set: Boolean(process.env.AZURE_TENANT_ID),
      AZURE_LOG_ANALYTICS_WORKSPACE_ID_set: Boolean(process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID),
    },
    "Azure configuration at startup",
  );
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  logAzureConfig();

  void startBudgetAlertScheduler();
  await startCostSnapshotRefresh();
  void startAnomalyDismissalCleanup();
});
