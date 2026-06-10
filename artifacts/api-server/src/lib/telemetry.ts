/**
 * Azure Application Insights telemetry initialisation.
 *
 * Must be imported BEFORE any other module in the entry point so the SDK can
 * patch Node built-ins (http, https, etc.) for auto-instrumentation.
 *
 * Config-gated: does nothing when APPLICATIONINSIGHTS_CONNECTION_STRING is
 * absent (Replit dev preview, CI).  In production on Azure Container Apps the
 * connection string is set as an env var on ca-orbit-prod-v2.
 */

import appInsights from "applicationinsights";

const cs = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

let _started = false;

if (cs) {
  try {
    appInsights
      .setup(cs)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectConsole(false)
      .setUseDiskRetryCaching(false)
      .start();
    _started = true;
  } catch (err) {
    // Write directly to stderr so this is visible even before the logger loads.
    // A bad connection string must never crash the process.
    process.stderr.write(
      `[telemetry] Application Insights setup failed — telemetry disabled: ${String(err)}\n`,
    );
  }
}

/** The live client, or null when telemetry is not configured or failed to start. */
export const telemetryClient: appInsights.TelemetryClient | null =
  _started ? appInsights.defaultClient : null;
