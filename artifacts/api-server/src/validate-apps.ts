/**
 * Standalone validation script — run via:
 *   pnpm --filter @workspace/api-server run validate-apps
 *
 * Validates every entry in the APPS inventory against the GetAppResponse Zod
 * schema (the OpenAPI contract for an individual app).  Exits with code 1 and
 * prints a detailed diff when any entry is invalid so CI can catch drift before
 * it reaches production.
 */
import { APPS } from "./routes/orbit.js";
import { GetAppResponse } from "@workspace/api-zod";

let hasErrors = false;

for (const app of APPS) {
  const result = GetAppResponse.safeParse(app);
  if (!result.success) {
    console.error(`\n✗ APPS["${app.id}"] failed validation:`);
    console.error(JSON.stringify(result.error.format(), null, 2));
    hasErrors = true;
  }
}

if (hasErrors) {
  console.error(
    "\nAPPS validation failed. Fix the entries above before deploying.",
  );
  process.exit(1);
}

console.log(`✓ All ${APPS.length} APPS entries satisfy the GetAppResponse schema.`);
