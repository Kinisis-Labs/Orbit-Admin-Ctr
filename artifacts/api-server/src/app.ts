import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/session";
import { isEntraConfigured } from "./lib/entra";

// Fail closed in production: never serve protected routes with auth disabled.
// The mock fallback (requireAuth no-op) is only acceptable in development.
if (process.env.NODE_ENV === "production" && !isEntraConfigured()) {
  throw new Error(
    "Entra ID auth is not fully configured (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI) — refusing to start in production with authentication disabled.",
  );
}

const app: Express = express();

// Behind Azure Front Door / the Replit proxy, trust the first proxy hop so
// secure cookies and req.protocol are correct.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use("/api", router);

export default app;
