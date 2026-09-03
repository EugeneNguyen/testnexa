import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * RBAC-1 E2E: real browser, full stack (nginx -> frontend -> backend ->
 * Postgres), exercising the actual `/signup` page (ADR-0016, `Signup.tsx`).
 *
 * ASSUMPTION (documented per this task's brief, deliberately not swept under
 * the rug): unlike AUTH-1's login spec, this can't rely on a fixture account
 * seeded ahead of time — `POST /auth/signup` only ever succeeds once,
 * deployment-wide (RBAC-1 / ADR-0016's bootstrap-only design), and this
 * isolated env's DB may already have >=1 `Organization` row left over from
 * an earlier integration/E2E run by the time this spec executes (backend
 * integration tests create-then-delete their own orgs, but an interrupted
 * run, or another spec that already ran in the same env, could leave the
 * "signup is now closed" state in place). Rather than assume a fresh-
 * instance state this test has no way to guarantee, it submits the real
 * signup form and branches on whichever of the two documented outcomes
 * actually occurs:
 * - genuinely fresh (0 orgs): signup succeeds and lands on the new org's own
 *   authenticated view (TC-RBAC-001's UI-level proof) — this test then
 *   cleans up the org/user it just created.
 * - already bootstrapped (>=1 org): the backend's `409 signup_closed`
 *   surfaces as an inline form error, no redirect (TC-RBAC-021's UI-level
 *   proof) — nothing to clean up.
 * Either branch is a real, meaningful assertion; skipping outright would
 * leave this flow with zero UI-level coverage whenever the env isn't
 * pristine at E2E time.
 *
 * Target environment: the isolated `testnexa-rbac1` Compose project
 * (`E2E_BASE_URL`, set externally per this task's brief), never the main
 * `testnexa` stack. Container name overridable via env var for portability.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-rbac1-backend-1";

// FK-safe cleanup for the fresh-instance branch only — looks the created
// User/Organization up by the exact email/slug this test submitted, mirrors
// auth-logout.spec.ts's/auth-agents.spec.ts's CLEANUP_SCRIPT convention.
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

email, org_slug = sys.argv[1], sys.argv[2]

async def main():
    async with AsyncSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalars().first()
        org = (await session.execute(select(Organization).where(Organization.slug == org_slug))).scalars().first()
        if user is not None:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user.actor_id))
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user.actor_id))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user.actor_id))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user.actor_id))
        if org is not None:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org.id))
            await session.execute(delete(Organization).where(Organization.id == org.id))
        if user is not None:
            await session.execute(delete(User).where(User.actor_id == user.actor_id))
            await session.execute(delete(Actor).where(Actor.id == user.actor_id))
        await session.commit()

asyncio.run(main())
`;

function cleanup(email: string, orgSlug: string): void {
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", email, orgSlug], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

test("bootstrap signup succeeds on a fresh instance, or shows signup-closed once already bootstrapped (TC-RBAC-001 / TC-RBAC-021)", async ({
  page,
}) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-rbac1-signup-${suffix}@example.com`;
  const password = "E2ETestPass123!";
  const orgSlug = `e2e-rbac1-${suffix}`;

  await page.goto("/signup");
  await page.getByLabel(/your name/i).fill("E2E RBAC-1 Admin");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByLabel(/organization name/i).fill("E2E RBAC-1 Org");
  await page.getByLabel(/organization slug/i).fill(orgSlug);
  await page.getByRole("button", { name: /create organization/i }).click();

  const successUrlPattern = /\/orgs\/[0-9a-f-]+/i;
  const closedErrorLocator = page.getByText(/self-registration is closed/i);

  // Race the two only-possible outcomes rather than assuming either one.
  await Promise.race([
    page.waitForURL(successUrlPattern, { timeout: 10_000 }).catch(() => undefined),
    closedErrorLocator.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined),
  ]);

  if (successUrlPattern.test(page.url())) {
    // Fresh-instance branch (TC-RBAC-001): landed on the new org's own view.
    await expect(page).toHaveURL(successUrlPattern);
    await expect(page.getByRole("heading", { name: /^Org: /i })).toBeVisible();
    cleanup(email, orgSlug);
  } else {
    // Already-bootstrapped branch (TC-RBAC-021): signup closed, inline
    // error shown, the form never navigates away.
    await expect(closedErrorLocator).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  }
});
