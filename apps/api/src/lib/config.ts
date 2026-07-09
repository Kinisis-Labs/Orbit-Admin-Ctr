import { db } from "./db.js";
import { globalConfigTable, featureFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Simple in-process cache — TTL 60 s
const CONFIG_CACHE = new Map<string, { value: string; expiresAt: number }>();
const FLAG_CACHE = new Map<string, { value: boolean; expiresAt: number }>();
const TTL_MS = 60_000;

/** Read a global config value by key. Returns undefined if not found. */
export async function getConfigValue(key: string): Promise<string | undefined> {
  const now = Date.now();
  const cached = CONFIG_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const [row] = await db
    .select({ value: globalConfigTable.value })
    .from(globalConfigTable)
    .where(eq(globalConfigTable.key, key))
    .limit(1);

  if (!row) return undefined;
  CONFIG_CACHE.set(key, { value: row.value, expiresAt: now + TTL_MS });
  return row.value;
}

/** Read a feature flag by name. Returns false if not found. */
export async function isFeatureEnabled(name: string): Promise<boolean> {
  const now = Date.now();
  const cached = FLAG_CACHE.get(name);
  if (cached && cached.expiresAt > now) return cached.value;

  const [row] = await db
    .select({ enabled: featureFlagsTable.enabled })
    .from(featureFlagsTable)
    .where(eq(featureFlagsTable.name, name))
    .limit(1);

  const value = row?.enabled ?? false;
  FLAG_CACHE.set(name, { value, expiresAt: now + TTL_MS });
  return value;
}

/** Invalidate the in-process cache for a key after a write. */
export function invalidateConfigCache(key: string) {
  CONFIG_CACHE.delete(key);
}

export function invalidateFlagCache(name: string) {
  FLAG_CACHE.delete(name);
}
