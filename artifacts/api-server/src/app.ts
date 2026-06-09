import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import clerkWebhookRouter from "./routes/clerkWebhook";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/session";
import { isEntraConfigured } from "./lib/entra";

// Refuse to start if Entra ID is not fully configured.
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
    `Entra ID auth is not fully configured — missing: ${missing.join(", ")} — refusing to start in production with authentication disabled.`,
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

// Clerk webhooks need the raw request body for Svix signature verification, so
// they must be mounted BEFORE the global JSON body parser consumes the stream.
app.use("/api/webhooks/clerk", clerkWebhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use("/api", router);

export default app;
