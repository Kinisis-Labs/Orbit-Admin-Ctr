import type { Express } from "express";

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
  ENTRA_REDIRECT_URI_set: !!process.env.ENTRA_REDIRECT_URI,
  SESSION_SECRET_set: !!process.env.SESSION_SECRET,
  DATABASE_URL_set: !!process.env.DATABASE_URL,
});

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

let appModule: { default: Express };
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

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Orbit API server listening");
});
