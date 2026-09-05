import { expect, test } from "@playwright/test";

/**
 * LANDING-1 E2E (ADR-0024): real browser, full stack. `/` now serves the
 * public `LandingPage` for a logged-out visitor — previously
 * `ScaffoldVerificationPage` (the `GET /api/health` wiring-proof widget,
 * deleted outright; see `scaffold-smoke.spec.ts` for that check's
 * direct-`/api/health` replacement).
 */
test("home page renders the public landing page, not the old scaffold health-check widget", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /testnexa/i })).toBeVisible();
  await expect(page.getByText(/backend:/i)).toHaveCount(0);
});

test("clicking 'Log in' navigates to /login and renders the Login screen", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: /log in/i }).click();

  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /log in/i })).toBeVisible();
});

test("clicking 'Sign up' navigates to /signup", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: /sign up/i }).click();

  await page.waitForURL(/\/signup$/);
});
