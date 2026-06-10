import { db, featureFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Reads a feature flag from the Postgres DB.
 * Returns `true` (enabled) when the flag row does not exist yet — same
 * safe-default behaviour as the App Configuration path.
 */
export async function getDbFeatureFlag(flagName: string): Promise<boolean> {
  try {
    const row = await db
      .select({ enabled: featureFlagsTable.enabled })
      .from(featureFlagsTable)
      .where(eq(featureFlagsTable.name, flagName))
      .limit(1);
    return row.length === 0 ? true : row[0].enabled;
  } catch (err) {
    logger.warn({ err, flagName }, "DB feature flag read failed — defaulting to enabled");
    return true;
  }
}

/**
 * Writes (upserts) a feature flag to the Postgres DB.
 * Throws on DB errors so callers can return an appropriate HTTP response.
 */
export async function setDbFeatureFlag(flagName: string, enabled: boolean): Promise<void> {
  await db
    .insert(featureFlagsTable)
    .values({ name: flagName, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: featureFlagsTable.name,
      set: { enabled, updatedAt: new Date() },
    });
}
