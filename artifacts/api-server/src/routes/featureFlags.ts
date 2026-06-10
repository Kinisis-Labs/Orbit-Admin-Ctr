import { Router, type IRouter } from "express";
import {
  isAppConfigConfigured,
  getAppConfigFeatureFlag,
  setAppConfigFeatureFlag,
} from "../lib/appConfig.js";
import { getDbFeatureFlag, setDbFeatureFlag } from "../lib/featureFlagsDb.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

type FlagConfigStore = "live" | "db" | "mock";

interface FeatureFlagDef {
  name: string;
  label: string;
  description: string;
}

/**
 * All known feature flags in display order.
 * Add new flags here to expose them in the admin panel.
 */
const KNOWN_FLAGS: FeatureFlagDef[] = [
  {
    name: "play-subscriptions",
    label: "Play Subscriptions",
    description:
      "Google Play subscription financials surface (/play-subscriptions). When disabled, the page returns 404.",
  },
  {
    name: "apple-subscriptions",
    label: "App Store Subscriptions",
    description:
      "Apple App Store subscription financials surface (/apple-subscriptions). When disabled, the page returns 404.",
  },
];

const KNOWN_FLAG_NAMES = new Set(KNOWN_FLAGS.map((f) => f.name));

function getConfigStore(): FlagConfigStore {
  if (isAppConfigConfigured()) return "live";
  return "db";
}

// GET /admin/feature-flags — list all known flags with current state (requireAdmin)
router.get("/admin/feature-flags", requireAuth, requireAdmin, async (_req, res) => {
  const configStore = getConfigStore();
  const rows = await Promise.all(
    KNOWN_FLAGS.map(async (def) => {
      const enabled =
        configStore === "live"
          ? await getAppConfigFeatureFlag(def.name)
          : await getDbFeatureFlag(def.name);
      return { ...def, enabled, configStore };
    }),
  );
  res.json(rows);
});

// PUT /admin/feature-flags/:flagName — enable or disable a flag (requireAdmin)
router.put("/admin/feature-flags/:flagName", requireAuth, requireAdmin, async (req, res) => {
  const flagName = req.params["flagName"] as string;

  if (!KNOWN_FLAG_NAMES.has(flagName)) {
    res.status(404).json({ error: `Unknown feature flag: ${flagName}` });
    return;
  }

  const body = req.body as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !("enabled" in body) ||
    typeof (body as Record<string, unknown>).enabled !== "boolean"
  ) {
    res.status(400).json({ error: 'Request body must be { "enabled": true|false }' });
    return;
  }

  const { enabled } = body as { enabled: boolean };
  const configStore = getConfigStore();

  if (configStore === "live") {
    try {
      await setAppConfigFeatureFlag(flagName, enabled);
    } catch (err) {
      logger.error({ err, flagName, enabled }, "Failed to write feature flag to App Configuration");
      res.status(502).json({ error: "Failed to write to App Configuration store" });
      return;
    }
  } else {
    try {
      await setDbFeatureFlag(flagName, enabled);
    } catch (err) {
      logger.error({ err, flagName, enabled }, "Failed to write feature flag to database");
      res.status(502).json({ error: "Failed to write to database" });
      return;
    }
  }

  const def = KNOWN_FLAGS.find((f) => f.name === flagName)!;
  res.json({ ...def, enabled, configStore });
});

export default router;
