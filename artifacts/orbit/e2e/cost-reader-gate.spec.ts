/**
 * E2E tests: cost-reader group gate on financial pages
 *
 * The Play Subscriptions (/play-subscriptions) and App Store Subscriptions
 * (/apple-subscriptions) pages are gated by the Orbit-Cost-Readers group in
 * two places:
 *   1. Frontend — App.tsx wraps both routes in <RequireGroup group={COST_READER_GROUP}>
 *      which renders AccessDenied ("You don't have access to this page") when
 *      the user lacks the group.
 *   2. API — requireCostReader middleware returns 403 before any handler runs.
 *
 * In mock mode (Entra not configured) group membership is read from localStorage
 * under the key "orbit-mock-groups".  Injecting that key via addInitScript is
 * equivalent to signing in as a user with those groups.
 *
 * Relevant source:
 *   artifacts/orbit/src/App.tsx — Gated wrapper, routes /play-subscriptions +
 *     /apple-subscriptions
 *   artifacts/orbit/src/components/access-denied.tsx — AccessDenied + RequireGroup
 *   artifacts/orbit/src/components/layout.tsx — nav lock icons (trailingIcon on
 *     Play subscriptions / App Store subscriptions when !canSeeCost)
 *   artifacts/api-server/src/routes/index.ts — requireCostReader applied to
 *     playSubscriptionsRouter and appleSubscriptionsRouter
 *   artifacts/api-server/src/middlewares/auth.ts — requireCostReader
 */

import { test, expect } from "@playwright/test";

const MOCK_GROUPS_KEY = "orbit-mock-groups";

const GROUP_AUTHORIZED = "orbit-authorized-users";
const GROUP_COST_READER = "b7e3-aad-cost-readers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set localStorage groups before the page loads. */
function setGroups(groups: string[]) {
  return (key: string, value: string) => localStorage.setItem(key, value);
}

// ---------------------------------------------------------------------------
// Without Orbit-Cost-Readers
// ---------------------------------------------------------------------------

test.describe("cost-reader gate — user WITHOUT Orbit-Cost-Readers", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      (key: string, value: string) => localStorage.setItem(key, value),
      MOCK_GROUPS_KEY,
      JSON.stringify([GROUP_AUTHORIZED]),
    );
  });

  test("Play subscriptions nav item shows a lock/restriction indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const playNavItem = page.getByRole("link", { name: /Play subscriptions/i });
    await expect(playNavItem, "Play subscriptions nav item must be present in the sidebar").toBeVisible();

    const lockTitle = page.getByTitle(/Restricted to members of Orbit-Cost-Readers/i);
    await expect(
      lockTitle.first(),
      "A restriction indicator must be visible on the Cost nav section when the user lacks Orbit-Cost-Readers",
    ).toBeAttached();
  });

  test("App Store subscriptions nav item shows a lock/restriction indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const appleNavItem = page.getByRole("link", { name: /App Store subscriptions/i });
    await expect(appleNavItem, "App Store subscriptions nav item must be present in the sidebar").toBeVisible();

    const lockTitle = page.locator('[title*="Restricted to members of Orbit-Cost-Readers"]');
    await expect(
      lockTitle.first(),
      "A restriction indicator must be attached on the nav when the user lacks Orbit-Cost-Readers",
    ).toBeAttached();
  });

  test("navigating to /play-subscriptions shows the access-denied panel, not the page content", async ({ page }) => {
    await page.goto("/play-subscriptions");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("You don't have access to this page"),
      "Access-denied heading must appear for non-cost-reader user on /play-subscriptions",
    ).toBeVisible();

    await expect(
      page.getByText("Orbit-Cost-Readers"),
      "Access-denied panel must name the required group",
    ).toBeVisible();

    await expect(
      page.getByText("Active subscribers"),
      "The Play subscriptions stat tiles must NOT be visible for non-cost-reader user",
    ).not.toBeVisible();

    await expect(
      page.getByText("Subscriptions by application"),
      "The Play subscriptions table must NOT be visible for non-cost-reader user",
    ).not.toBeVisible();
  });

  test("navigating to /apple-subscriptions shows the access-denied panel, not the page content", async ({ page }) => {
    await page.goto("/apple-subscriptions");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("You don't have access to this page"),
      "Access-denied heading must appear for non-cost-reader user on /apple-subscriptions",
    ).toBeVisible();

    await expect(
      page.getByText("Orbit-Cost-Readers"),
      "Access-denied panel must name the required group",
    ).toBeVisible();

    await expect(
      page.getByText("Active subscribers"),
      "The App Store subscriptions stat tiles must NOT be visible for non-cost-reader user",
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// With Orbit-Cost-Readers
// ---------------------------------------------------------------------------

test.describe("cost-reader gate — user WITH Orbit-Cost-Readers", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      (key: string, value: string) => localStorage.setItem(key, value),
      MOCK_GROUPS_KEY,
      JSON.stringify([GROUP_AUTHORIZED, GROUP_COST_READER]),
    );
  });

  test("Play subscriptions nav item has no lock indicator", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const playNavItem = page.getByRole("link", { name: /Play subscriptions/i });
    await expect(playNavItem).toBeVisible();

    await expect(
      page.locator('[title*="Restricted to members of Orbit-Cost-Readers"]'),
      "No restriction indicator should appear when cost-reader is granted",
    ).not.toBeAttached();
  });

  test("/play-subscriptions renders the page content for cost-reader members", async ({ page }) => {
    await page.goto("/play-subscriptions");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /Play subscriptions/i }),
      "Page heading must be visible for cost-reader members",
    ).toBeVisible();

    await expect(
      page.getByText("You don't have access to this page"),
      "Access-denied panel must NOT be shown for cost-reader members",
    ).not.toBeVisible();

    await expect(
      page.getByText("Active subscribers"),
      "Stat tiles must be visible for cost-reader members",
    ).toBeVisible();
  });

  test("/apple-subscriptions renders the page content for cost-reader members", async ({ page }) => {
    await page.goto("/apple-subscriptions");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /App Store subscriptions/i }),
      "Page heading must be visible for cost-reader members",
    ).toBeVisible();

    await expect(
      page.getByText("You don't have access to this page"),
      "Access-denied panel must NOT be shown for cost-reader members",
    ).not.toBeVisible();

    await expect(
      page.getByText("Active subscribers"),
      "Stat tiles must be visible for cost-reader members",
    ).toBeVisible();
  });
});
