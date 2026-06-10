import { ApplicationInsights } from "@microsoft/applicationinsights-web";

const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING as
  | string
  | undefined;

let appInsights: ApplicationInsights | null = null;

if (connectionString) {
  appInsights = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: true,
      enableCorsCorrelation: true,
      enableRequestHeaderTracking: true,
      enableResponseHeaderTracking: true,
      disableFetchTracking: false,
      disableAjaxTracking: false,
    },
  });
  appInsights.loadAppInsights();
  appInsights.trackPageView();
}

export { appInsights };

export function trackException(error: Error, properties?: Record<string, string>) {
  appInsights?.trackException({ exception: error, properties });
}

export function trackEvent(name: string, properties?: Record<string, string>) {
  appInsights?.trackEvent({ name }, properties);
}
