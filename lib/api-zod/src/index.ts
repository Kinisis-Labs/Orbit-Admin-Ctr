export * from "./generated/api";
export * from "./generated/types";
// Resolve TS2308 ambiguity: Orval emits both a Zod schema const (path params) and
// a TS type (query params) with the same *Params name when an endpoint has both a
// path param and a query param. Explicitly re-exporting from the Zod side tells
// TypeScript which one wins.
export {
  GetInfrastructureParams,
  GetNetworkParams,
  GetTelemetryParams,
  GetAppAlertsParams,
  GetCostParams,
  GetGlobalCostSummaryQueryParams,
  QueryLogsParams,
  UpdateAlertConfigParams,
  UpdateAlertConfigBody,
  UpdateAppThresholdsBody,
  ListAppThresholdsLogParams,
} from "./generated/api";
