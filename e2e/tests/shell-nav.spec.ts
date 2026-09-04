import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-1 E2E (ADR-0018): the persistent CoreUI sidebar+navbar shell that
 * wraps every `ProtectedRoute` screen. Covers TC-SHELL-001..005 from
 * `docs/test-cases/2026-09-03-test-cases.md` (TC-SHELL-006 is a structural/
 * code-review criterion, not automatable, and is skipped here per that
 * doc's own note).
 *
 * Fixture seeding follows this directory's established convention
 * (`org-create-second.spec.ts`, `org-invite-suspend-lifecycle.spec.ts`):
 * seed directly via `AsyncSessionLocal` inside the target env's own backend
 * container (`docker exec ... python -`), since there is no bootstrap API
 * for arbitrary `Role`/`RoleAssignment` fixtures beyond `POST /auth/signup`
 * itself.
 *
 * One user is seeded with TWO active `OrgMembership`s (Org A + Org B) and an
 * org-wide `org_admin` `RoleAssignment` in Org A only (enough to render Org
 * A's Members screen with full content, not just a 403). Two active
 * memberships is what makes `POST /auth/login` resolve
 * `org_context: "picker"`, which is the ONLY way to reach `/orgs/pick` with
 * `AuthContext`'s in-memory `orgs` list populated: `Login.tsx`'s own
 * `orgContext === "picker" -> navigate("/orgs/pick")` effect is a
 * client-side transition, unlike a raw `page.goto("/orgs/pick")`, which
 * would be a full page reload that resets `AuthContext.orgs` back to `[]`
 * and immediately bounces `OrgPicker` back to `/login` (see that
 * component's own docstring, and `AuthContext.tsx`'s "Known simplification"
 * note on why org context does not survive a reload).
 *
 * Target environment: the isolated `testnexa-shell1-test` Compose project
 * (`E2E_BASE_URL`, set externally per this task's brief), never the main
 * `testnexa` stack (this repo's CLAUDE.md). Container name overridable via
 * env var, matching every other spec in this directory.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-shell1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededUser {
  email: string;
  password: string;
  userId: string;
  orgAId: string;
  orgBId: string;
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
    email = f"e2e-shell1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-1 E2E User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org_a = Organization(name="SHELL-1 E2E Org A", slug=f"shell1-e2e-a-{suffix}")
        org_b = Organization(name="SHELL-1 E2E Org B", slug=f"shell1-e2e-b-{suffix}")
        session.add_all([org_a, org_b])
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org_a.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))
        session.add(OrgMembership(org_id=org_b.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        # org_admin only in Org A: enough for the Members screen (Org A) to
        # render real content instead of a 403, per OrgMembers.tsx's own
        # docstring on its permission gate.
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org_a.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgAId": str(org_a.id),
            "orgBId": str(org_b.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring org-create-second.spec.ts's cleanup script.
const CLEANUP_SCRIPT = `
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

function seedUser(): SeededUser {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededUser;
}

function cleanup(user: SeededUser): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", user.userId, user.orgAId, user.orgBId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("SHELL-1 persistent sidebar + navbar shell", () => {
  test("TC-SHELL-001/002/003/005: shell wraps every ProtectedRoute screen, sidebar nav state is correct, and the org-home link fixes the members dead-end", async ({
    page,
  }) => {
    const user = seedUser();

    try {
      // --- Log in: two active memberships -> org_context "picker" ->
      // Login.tsx's own client-side redirect lands on /orgs/pick with
      // AuthContext.orgs populated (real UI flow, not a raw page.goto). ---
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(/\/orgs\/pick/);

      // TC-SHELL-001 (part 1/3): shell renders on /orgs/pick.
      await expect(page.locator(".sidebar")).toBeVisible();
      await expect(page.locator(".header")).toBeVisible();
      await expect(page.getByTestId("logout-button")).toBeVisible();

      // TC-SHELL-005: brand renders, org-scoped nav items absent (no orgId
      // route param on /orgs/pick).
      await expect(page.locator(".sidebar").getByText("TestNexa")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-org-home")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-org-members")).toHaveCount(0);

      // --- Navigate into Org A via the real UI (OrgPicker's list item). ---
      await page.getByText("SHELL-1 E2E Org A").click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgAId}$`));

      // TC-SHELL-001 (part 2/3): shell renders on /orgs/:orgId (org home).
      await expect(page.locator(".sidebar")).toBeVisible();
      await expect(page.locator(".header")).toBeVisible();
      await expect(page.getByRole("heading", { name: `Org: ${user.orgAId}` })).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-org-home")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-org-members")).toBeVisible();

      // --- Navigate to the Members screen (real UI nav entry point, same
      // as org-invite-suspend-lifecycle.spec.ts's own precedent). ---
      await page.getByTestId("sidebar-nav-org-members").click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgAId}/members`));

      // TC-SHELL-001 (part 3/3): shell renders on /orgs/:orgId/members.
      await expect(page.locator(".sidebar")).toBeVisible();
      await expect(page.locator(".header")).toBeVisible();

      // TC-SHELL-002: both nav items present; "Members" active, "Org home"
      // not (prefix-match regression check — AppSidebar.tsx's `end` prop on
      // the org-home NavLink is what this asserts against a regression of).
      await expect(page.getByTestId("sidebar-nav-org-home")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-org-members")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-org-members")).toHaveClass(/\bactive\b/);
      await expect(page.getByTestId("sidebar-nav-org-home")).not.toHaveClass(/\bactive\b/);

      // TC-SHELL-003 (release-blocking): a real Playwright click on the
      // sidebar's org-home nav link — NOT page.goBack() — closes the exact
      // dead-end this story fixes.
      await page.getByTestId("sidebar-nav-org-home").click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgAId}$`));
      await expect(page).not.toHaveURL(/\/members$/);
      await expect(page.getByRole("heading", { name: `Org: ${user.orgAId}` })).toBeVisible();
    } finally {
      cleanup(user);
    }
  });

  test("TC-SHELL-004: sidebar collapses on a narrow viewport and the header toggler shows it again", async ({
    page,
  }) => {
    const user = seedUser();

    try {
      // Narrow (mobile) viewport, set BEFORE any navigation — matching a
      // real mobile user loading the page already at this width, rather
      // than a desktop user live-resizing mid-session. `CSidebar`'s own
      // mobile detection (`isOnMobile`, via a `--cui-is-mobile` CSS custom
      // property) and its resulting `onVisibleChange` sync back into
      // `AppShell`'s state (see that file's docstring) both settle during
      // the several DOM/navigation events login+redirect already involve,
      // well before this test's own first sidebar assertion — avoiding a
      // race between that async sync and an immediate post-resize click
      // that a mid-session `setViewportSize` immediately followed by a
      // toggler click would otherwise risk.
      await page.setViewportSize({ width: 375, height: 812 });

      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(user.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(/\/orgs\/pick/);
      await page.getByText("SHELL-1 E2E Org A").click();
      await page.waitForURL(new RegExp(`/orgs/${user.orgAId}$`));

      const sidebar = page.locator(".sidebar");
      // CoreUI's own responsive sidebar behavior (no custom breakpoint
      // logic, per ADR-0018): on mobile, CSidebar only ever applies its own
      // `show` class when explicitly toggled visible — it starts collapsed.
      await expect(sidebar).not.toHaveClass(/\bshow\b/);

      await page.getByTestId("sidebar-toggler").click();
      await expect(sidebar).toHaveClass(/\bshow\b/);
    } finally {
      cleanup(user);
    }
  });
});
