import app from "./app";
import { logger } from "./lib/logger";
import { startBudgetAlertScheduler } from "./lib/budgetAlerts";

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

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  logAzureConfig();

  startBudgetAlertScheduler();
});
