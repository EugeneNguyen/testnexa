import { expect, test } from "@playwright/test";

/**
 * AUTH-1 E2E: real browser, full stack (nginx -> frontend -> backend ->
 * Postgres), exercising the actual Login page against a seeded account.
 *
 * Fixture account is seeded directly into the target environment's DB (not
 * created by these tests) — see the AUTH-1 test-env handoff for credentials.
 * Overridable via env vars so this spec works against any environment with
 * the same seeded account, not just one hardcoded port.
 */
const E2E_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "e2e-auth1@example.com";
const E2E_PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "E2ETestPass123!";

test("valid login redirects to the org view (single active org -> auto-select)", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();

  // Single active OrgMembership for this fixture user -> org_context "auto"
  // -> redirected straight to /orgs/{orgId}, never the picker.
  await page.waitForURL(/\/orgs\/[0-9a-f-]+/i);
  await expect(page).not.toHaveURL(/\/orgs\/pick/);
});

test("invalid credentials show a generic error, no redirect", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: /log in|sign in/i }).click();

  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("unknown email shows the identical generic error (no enumeration leak)", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill("definitely-not-a-real-user@example.com");
  await page.getByLabel(/password/i).fill("whatever-password");
  await page.getByRole("button", { name: /log in|sign in/i }).click();

  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
