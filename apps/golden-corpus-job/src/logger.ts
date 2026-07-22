export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const ALLOWED_FIELDS = new Set([
  "executionId",
  "datasetVersion",
  "manifestHashPrefix",
  "approvedCount",
  "acceptedCount",
  "rejectedCount",
  "durationMs",
  "status",
  "safeErrorCode",
  "dryRun",
]);

export function createLogger(level: "debug" | "info" | "warn" | "error"): Logger {
  const threshold = ["debug", "info", "warn", "error"].indexOf(level);
  const emit = (eventLevel: "debug" | "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) => {
    if (["debug", "info", "warn", "error"].indexOf(eventLevel) < threshold) return;
    const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => ALLOWED_FIELDS.has(key)));
    process.stdout.write(`${JSON.stringify({ level: eventLevel, event, ...safe })}\n`);
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
