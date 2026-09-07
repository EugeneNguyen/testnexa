import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * DASH-1 E2E (ADR-0035): real browser, full stack. Replaces
 * `landing-page.spec.ts`, deleted along with the `LandingPage` screen it
 * tested — `/` is now a pure auth-state redirect with no content of its own.
 *
 * Covers TC-DASH-001 (anon `/` -> `/login`), TC-DASH-002 (anon `/dashboard`
 * direct -> `/login`), TC-DASH-003 (authed `/` -> `/dashboard`), and
 * TC-DASH-006 (the regression test this story exists for: a real page reload
 * while logged in still reaches `/dashboard`).
 *
 * TC-DASH-006 is the load-bearing one. The bug being fixed is that ADR-0024's
 * root logic branched on `orgContext`/`orgs`, which `AuthContext`'s
 * documented AUTH-2 boot-refresh gap leaves unresolved (`null`/`[]`) after any
 * page reload — `POST /auth/refresh` returns `{access_token}` only. So a user
 * with a perfectly valid session cookie who reloaded fell through to the
 * public landing page. A shallow "log in, dashboard renders" assertion cannot
 * catch that, because a same-document client-side navigation keeps
 * `orgContext` alive in memory. This spec therefore asserts on a genuine
 * *document* load (`page.goto` / `page.reload`, both of which discard the JS
 * heap) and additionally proves, in-test, that (a) the boot-time silent
 * refresh really fired and succeeded on that fresh load, and (b)
 * `orgContext`/`orgs` really are unresolved afterward — using `OrgPicker`'s
 * own pre-existing empty-`orgs` bounce to `/login` as the observable signal.
 * Without (a) and (b) the test could pass for the wrong reason.
 *
 * Fixture seeding follows this directory's standard pattern (see
 * `req1-requirements-ui.spec.ts`): one user + Organization + active
 * OrgMembership + org-wide `org_admin` RoleAssignment, seeded via
 * `docker exec` into the isolated stack's backend container, cleaned up
 * FK-safe in a `finally`.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names
 * its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-dash1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-dash1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="DASH-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="DASH-1 E2E Org", slug=f"dash1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order (link/dependent rows before their parents).
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id = sys.argv[1], sys.argv[2]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedFixture(): SeededFixture {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededFixture;
}

function cleanup(fixture: SeededFixture): void {
  execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgId], {
    input: CLEANUP_SCRIPT,
    encoding: "utf-8",
  });
}

test.describe("DASH-1: root route redirects on auth state, dashboard placeholder", () => {
  // TC-DASH-001
  test("logged-out visitor loading / is redirected to /login, with no landing content ever painting", async ({
    page,
  }) => {
    await page.goto("/");

    await page.waitForURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /^log in$/i })).toBeVisible();

    // The deleted LandingPage's product-name heading and its "Log in" /
    // "Sign up" CTA *links* must not exist anywhere. (Scoped to links on
    // purpose — the Login screen legitimately has a "Log in" submit button
    // and its own "Sign up" link, so a role-agnostic text assertion here
    // would be vacuous.)
    await expect(page.getByRole("link", { name: /^log in$/i })).toHaveCount(0);
    await expect(page.getByText(/self-hosted, istqb\/ieee 829-aligned test management/i)).toHaveCount(0);
  });

  // TC-DASH-002
  test("logged-out visitor navigating directly to /dashboard is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");

    await page.waitForURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /^log in$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^dashboard$/i })).toHaveCount(0);
  });

  // TC-DASH-003
  test("authenticated visitor loading / is redirected to /dashboard", async ({ page }) => {
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      // Login.tsx's own post-auth orgContext redirect — untouched by ADR-0035.
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto("/");

      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
      await expect(page.getByText(/nothing here yet/i)).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  // TC-DASH-006 — the regression test for the bug this story fixes.
  test("reloading while logged in still lands on /dashboard, not /login, with orgContext unresolved", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      // --- Log in normally. This populates orgContext/orgs in memory. -------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- A real document load of `/`. ------------------------------------
      // This is the actual reload semantics under test: `page.goto` discards
      // the JS heap, so the in-memory orgContext/orgs from the login response
      // above are gone and only the httpOnly refresh cookie survives. The
      // boot-time silent refresh is therefore the only thing that can restore
      // a session — and per the AUTH-2 gap it restores the access token
      // *only*, never orgContext/orgs.
      const bootRefresh = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/auth/refresh") && response.request().method() === "POST",
      );
      await page.goto("/");
      const bootRefreshResponse = await bootRefresh;

      // Proof this really was a cold boot restoring a session from the cookie,
      // rather than a same-document navigation that never lost its state.
      expect(bootRefreshResponse.status()).toBe(200);

      // The assertion the whole story exists for: /dashboard, not /login.
      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/dashboard");

      // --- Same again via a literal browser reload. -------------------------
      // `/` replace-navigates to `/dashboard`, so the address bar is never
      // sitting on `/` to be reloaded directly; this reloads the settled
      // destination instead, proving the protected route survives a reload
      // too and not just the root guard.
      await page.reload();
      await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/dashboard");

      // --- Prove orgContext/orgs really are unresolved after the reload. ----
      // Otherwise the /dashboard result above could pass for the wrong
      // reason. OrgPicker's own pre-existing empty-`orgs` guard bounces to
      // /login — that bounce happening here is the observable symptom of the
      // AUTH-2 gap, i.e. exactly the state that used to break `/`.
      await page.goto("/orgs/pick");
      await page.waitForURL(/\/login$/);
    } finally {
      cleanup(fixture);
    }
  });
});
