import { ApplicationInsights } from "@microsoft/applicationinsights-web";

const connStr = import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING as string | undefined;

let appInsights: ApplicationInsights | null = null;

if (connStr) {
  appInsights = new ApplicationInsights({
    config: {
      connectionString: connStr,
      enableAutoRouteTracking: true,
      enableCorsCorrelation: true,
      enableRequestHeaderTracking: true,
      enableResponseHeaderTracking: true,
      disableFetchTracking: false,
    },
  });
  appInsights.loadAppInsights();
  appInsights.trackPageView();
}

export { appInsights };
