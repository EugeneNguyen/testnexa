import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * DASH-1 E2E (ADR-0035): real browser, full stack. Replaces
 * `landing-page.spec.ts`, deleted along with the `LandingPage` screen it
 * tested — `/` is now a pure auth-state redirect with no content of its own.
 *
 * Covers TC-DASH-001 (anon `/` -> `/login`), TC-DASH-002 (anon `/dashboard`
 * direct -> `/login`), TC-DASH-003 (authed `/` -> `/dashboard`, 0-or-2+-org
 * precondition), TC-DASH-006 (the regression test this story exists for: a
 * real page reload while logged in still reaches `/dashboard`), and — since
 * DASH-3 (ADR-0063) — TC-DASH-007 (single-org auto-redirect), TC-DASH-011
 * (the org list itself survives a reload, fetched fresh not read from
 * `AuthContext.orgs`), and TC-DASH-012 (`/orgs/pick` no longer resolves to
 * anything).
 *
 * **DASH-3 precondition update:** `Dashboard` now auto-advances past
 * `/dashboard` for an exactly-1-org account (TC-DASH-007), so TC-DASH-003/
 * TC-DASH-006 — which assert the visitor actually *settles* on `/dashboard`
 * — now seed a 2-org fixture instead of the original 1-org one, matching
 * both TCs' own corrected "0 or 2+ orgs" precondition in
 * `docs/test-cases/2026-09-03-test-cases.md`.
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
 * refresh really fired and succeeded on that fresh load, and (b) the org
 * list rendered after the reload came from a fresh `GET /auth/me/orgs` call
 * `Dashboard` itself makes — not from any surviving in-memory state, since
 * none survives a real document load. Without (a) and (b) the test could
 * pass for the wrong reason.
 *
 * Fixture seeding follows this directory's standard pattern (see
 * `req1-requirements-ui.spec.ts`): one user + Organization(s) + active
 * OrgMembership(s) + org-wide `org_admin` RoleAssignment, seeded via
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

interface SeededTwoOrgFixture {
  email: string;
  password: string;
  userId: string;
  orgAId: string;
  orgAName: string;
  orgBId: string;
  orgBName: string;
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

// DASH-3: a 2-org fixture, for TCs that need Dashboard to render its
// "Select an organization" chooser rather than auto-advancing.
const TWO_ORG_SEED_SCRIPT = `
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
    email = f"e2e-dash3-{suffix}@example.com"
    org_a_name = f"DASH-3 E2E Org A {suffix}"
    org_b_name = f"DASH-3 E2E Org B {suffix}"
    async with AsyncSessionLocal() as session:
        user = User(name="DASH-3 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org_a = Organization(name=org_a_name, slug=f"dash3-e2e-a-{suffix}")
        org_b = Organization(name=org_b_name, slug=f"dash3-e2e-b-{suffix}")
        session.add_all([org_a, org_b])
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org_a.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))
        session.add(OrgMembership(org_id=org_b.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_a.id, project_id=None, role_id=org_admin_role.id))
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_b.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgAId": str(org_a.id),
            "orgAName": org_a_name,
            "orgBId": str(org_b.id),
            "orgBName": org_b_name,
        }))

asyncio.run(main())
`;

const TWO_ORG_CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_a_id, org_b_id = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id.in_([org_a_id, org_b_id])))
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

function seedTwoOrgFixture(): SeededTwoOrgFixture {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: TWO_ORG_SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededTwoOrgFixture;
}

function cleanupTwoOrgFixture(fixture: SeededTwoOrgFixture): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgAId, fixture.orgBId],
    { input: TWO_ORG_CLEANUP_SCRIPT, encoding: "utf-8" },
  );
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

  // TC-DASH-003 (DASH-3: 0-or-2+-org precondition — a 2-org fixture here)
  test("authenticated visitor (2+ orgs) loading / is redirected to /dashboard, showing the org chooser", async ({
    page,
  }) => {
    const fixture = seedTwoOrgFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      // Login.tsx's own post-auth redirect (DASH-3/ADR-0063): always /dashboard.
      await page.waitForURL(/\/dashboard$/);

      await page.goto("/");

      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /select an organization/i })).toBeVisible();
      await expect(page.getByText(fixture.orgAName)).toBeVisible();
      await expect(page.getByText(fixture.orgBName)).toBeVisible();
    } finally {
      cleanupTwoOrgFixture(fixture);
    }
  });

  // TC-DASH-007 (DASH-3): single-org auto-redirect, no intermediate render.
  test("authenticated visitor (exactly 1 org) loading /dashboard lands straight on their org, no click", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}$`));

      // A direct hit on /dashboard (not via /) must also bounce onward.
      await page.goto("/dashboard");
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}$`));
      await expect(page.getByText(/select an organization/i)).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  // TC-DASH-006 (DASH-3: 0-or-2+-org precondition) + TC-DASH-011 (org list
  // survives a reload, fetched fresh).
  test("reloading while logged in (2+ orgs) still lands on /dashboard with the org list intact, fetched fresh", async ({
    page,
  }) => {
    const fixture = seedTwoOrgFixture();
    try {
      // --- Log in normally. ---
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByText(fixture.orgAName)).toBeVisible();

      // --- A real document load of `/`. ---
      // This is the actual reload semantics under test: `page.goto` discards
      // the JS heap, so any in-memory AuthContext state from the login above
      // is gone and only the httpOnly refresh cookie survives. The boot-time
      // silent refresh is therefore the only thing that can restore a
      // session — and per the AUTH-2 gap it restores the access token
      // *only*, never `AuthContext.orgs`.
      const bootRefresh = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/auth/refresh") && response.request().method() === "POST",
      );
      // The fresh-fetch proof this pass adds (TC-DASH-011): Dashboard's own
      // GET /auth/me/orgs call must fire again after the reload — it cannot
      // be reusing any surviving in-memory list, because a real document
      // load leaves none.
      const orgsRefetch = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/auth/me/orgs") && response.request().method() === "GET",
      );
      await page.goto("/");
      const bootRefreshResponse = await bootRefresh;
      const orgsRefetchResponse = await orgsRefetch;

      // Proof this really was a cold boot restoring a session from the cookie.
      expect(bootRefreshResponse.status()).toBe(200);
      expect(orgsRefetchResponse.status()).toBe(200);

      // The assertion the whole story exists for: /dashboard, not /login —
      // and the chooser list itself renders correctly from that fresh fetch.
      await page.waitForURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /select an organization/i })).toBeVisible();
      await expect(page.getByText(fixture.orgAName)).toBeVisible();
      await expect(page.getByText(fixture.orgBName)).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/dashboard");

      // --- Same again via a literal browser reload. ---
      await page.reload();
      await expect(page.getByRole("heading", { name: /select an organization/i })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    } finally {
      cleanupTwoOrgFixture(fixture);
    }
  });

  // TC-DASH-012 (DASH-3): /orgs/pick no longer resolves to anything.
  test("/orgs/pick no longer resolves to OrgPicker — the route is retired, not merely re-labeled", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}$`));

      await page.goto("/orgs/pick");

      // OrgPicker's own distinguishing content (its heading, its "New
      // Organization"/"Create organization" button) must be absent — no
      // route in App.tsx matches this path anymore.
      await expect(page.getByRole("heading", { name: /choose an organization/i })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /select an organization/i })).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
