import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { sessionMiddleware } from "./lib/session.js";
import { isEntraConfigured } from "./lib/entra.js";

if (!isEntraConfigured()) {
  const missing = [
    ["ENTRA_TENANT_ID", process.env.ENTRA_TENANT_ID],
    ["ENTRA_CLIENT_ID", process.env.ENTRA_CLIENT_ID],
    ["ENTRA_CLIENT_SECRET", process.env.ENTRA_CLIENT_SECRET],
    ["ENTRA_REDIRECT_URI", process.env.ENTRA_REDIRECT_URI],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  throw new Error(
    `Entra ID auth is not fully configured — missing: ${missing.join(", ")} — refusing to start.`,
  );
}

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

const allowedOrigin = (() => {
  const redirectUri = process.env.ENTRA_REDIRECT_URI;
  if (!redirectUri) return true;
  try {
    const { origin } = new URL(redirectUri);
    return origin;
  } catch {
    return true;
  }
})();

app.use(cors({ origin: allowedOrigin, credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use("/api", router);

export default app;
