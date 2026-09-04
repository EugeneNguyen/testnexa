import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * RBAC-2 E2E (ADR-0017): the single named end-to-end flow this story's
 * Master Test Plan/WBS calls for — invite -> accept -> suspend -> verify
 * blocked -> reactivate -> verify restored. Deliberately narrow (one flow,
 * not one per TC-RBAC-*), matching this repo's own E2E risk-mitigation
 * stance of a small number of named flows layered on top of the exhaustive
 * integration-test coverage in `backend/tests/integration/
 * test_org_memberships.py`.
 *
 * Two separate `BrowserContext`s (admin / invitee) are used rather than one
 * shared `page`, because both actors need their own live session at the same
 * time — admin re-visits the Members screen to suspend/reactivate while the
 * invitee's own token must still be independently usable for the
 * post-suspend/reactivate access checks below. A single `page`/token store
 * would have the second login silently clobber the first (`AuthContext`'s
 * token store is a single module-level slot, per that file's own docstring).
 *
 * Fixture seeding follows `org-create-second.spec.ts`'s exact convention:
 * `docker exec <backend-container> python -` running an async script against
 * `AsyncSessionLocal`, since there is no bootstrap API for arbitrary
 * `Role`/`RoleAssignment` fixtures beyond `POST /auth/signup` itself. Only
 * the org_admin + org are pre-seeded — the invitee `User`/`OrgMembership`/
 * `Invite` rows are the real product of the UI flow itself (TC-RBAC-004/005
 * territory), not fixture data, so seeding them ahead of time would just be
 * testing less.
 *
 * Step 4/5's "does access actually change" checks are done via Playwright's
 * `request` fixture directly against `GET /orgs/{org_id}/members` using the
 * invitee's own bearer token, per this task's own brief: RBAC-2 ships no
 * post-login screen an ordinary (non-org_admin) member can reach that would
 * surface the suspended-member gate through a click — the invitee holds no
 * `Permission` at all (RBAC-2 assigns no role on invite/accept), so the
 * *code* returned by that same call is itself the signal: `membership_inactive`
 * while suspended, back to `permission_denied` once reactivated (never `200`
 * for this actor, since it never held `org_membership.read` in the first
 * place). `app/core/rbac.py`'s `require_permission` checks the
 * suspended-member gate strictly before the permission check runs, so this
 * transition is fully attributable to membership status alone, not to any
 * permission grant/revoke.
 *
 * Target environment: an isolated Compose project, never the main `testnexa`
 * stack (this repo's CLAUDE.md). Container name overridable via env var,
 * matching every other spec in this directory.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-test-rbac2-backend-1";
const ADMIN_PASSWORD = "E2ETestPass123!";
const INVITEE_PASSWORD = "InviteeE2EPass456!";

interface SeededOrgAdmin {
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

PASSWORD = "${ADMIN_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-rbac2-admin-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="RBAC-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="RBAC-2 E2E Org", slug=f"rbac2-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(
            OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now)
        )

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        # org_admin -> org_membership.* bundle (RBAC-4's seeded system Role),
        # org-wide RoleAssignment, matching org-create-second.spec.ts's own
        # fixture precedent exactly.
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

// FK-safe delete order, mirroring test_org_memberships.py's `_cleanup`
// helper. `inviteeEmail` is looked up by email — its `User`/`actor_id` row is
// a real product of the UI flow itself, never known ahead of time. `Invite`
// rows are never deleted explicitly: `Invite.org_membership_id` cascades at
// the DB level whenever the owning `OrgMembership` row is deleted below
// (same precedent that integration test file's module docstring documents).
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import select, delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

admin_email, invitee_email, org_id = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User.actor_id).where(User.email.in_([admin_email, invitee_email])))
        user_ids = [row[0] for row in result.all()]

        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
            await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
        if user_ids:
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()

asyncio.run(main())
`;

function seedOrgAdmin(): SeededOrgAdmin {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededOrgAdmin;
}

function cleanup(admin: SeededOrgAdmin, inviteeEmail: string): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", admin.email, inviteeEmail, admin.orgId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("RBAC-2 org member invite/suspend/reactivate lifecycle", () => {
  test("org_admin invites a member by email; the invitee accepts and lands authenticated; org_admin suspends then reactivates them", async ({
    browser,
    request,
  }) => {
    const admin = seedOrgAdmin();
    const inviteeEmail = `e2e-rbac2-invitee-${Date.now().toString(36)}@example.com`;

    const adminContext = await browser.newContext();
    const inviteeContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const inviteePage = await inviteeContext.newPage();

    try {
      // 1. org_admin logs in and lands directly on their (only) org's home
      // page (single active membership -> org_context "auto").
      await adminPage.goto("/login");
      await adminPage.getByLabel(/email/i).fill(admin.email);
      await adminPage.getByLabel(/^password$/i).fill(admin.password);
      await adminPage.getByRole("button", { name: /log in|sign in/i }).click();
      await adminPage.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));

      // Navigate to the Members screen via the real UI nav entry point
      // (OrgHome's own "Members" link, per that component's docstring) and
      // invite the new user by email (TC-RBAC-004 territory, exercised
      // end-to-end through the real UI here).
      await adminPage.getByRole("link", { name: /^members$/i }).click();
      await adminPage.waitForURL(new RegExp(`/orgs/${admin.orgId}/members`));

      await adminPage.getByLabel(/invite by email/i).fill(inviteeEmail);
      await adminPage.getByRole("button", { name: /send invite/i }).click();

      await expect(adminPage.getByText(/invite created/i)).toBeVisible();
      const inviteLink = await adminPage.locator("input[readonly]").inputValue();
      // Link shape is `.../invites/{token}/accept` (path param, matching the
      // real `/invites/:token/accept` React Router route) — not a query
      // param, so extract accordingly.
      expect(inviteLink).toMatch(/\/invites\/[^/]+\/accept$/);
      const token = inviteLink.split("/invites/")[1].split("/accept")[0];
      expect(token).toBeTruthy();

      // The invitee's row is now visible with status "invited".
      const inviteeRowBeforeAccept = adminPage.getByRole("row").filter({ hasText: inviteeEmail });
      await expect(inviteeRowBeforeAccept).toBeVisible();
      await expect(inviteeRowBeforeAccept.getByText(/invited/i)).toBeVisible();

      // 2. The invitee uses the real invite link's token, in their own
      // browser session, to set a password and land authenticated
      // (TC-RBAC-005: `/invites/{token}/accept`, no pre-existing account).
      await inviteePage.goto(`/invites/${token}/accept`);
      await inviteePage.getByLabel("Password", { exact: true }).fill(INVITEE_PASSWORD);
      await inviteePage.getByLabel(/confirm password/i).fill(INVITEE_PASSWORD);
      await inviteePage.getByRole("button", { name: /set password|setting password/i }).click();

      // Exactly one active org membership (this one) -> org_context "auto"
      // -> AcceptInvite's own redirect effect lands here, the same
      // access-token + org-context wiring Login/Signup already use.
      await inviteePage.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));
      await expect(inviteePage.getByRole("heading", { name: `Org: ${admin.orgId}` })).toBeVisible();

      // A fresh API-level login as the invitee gives us their own bearer
      // token for the access checks below, independent of inviteePage's own
      // in-memory token store (which this test has no way to read out of).
      const inviteeLoginResponse = await request.post("/api/v1/auth/login", {
        data: { email: inviteeEmail, password: INVITEE_PASSWORD },
      });
      expect(inviteeLoginResponse.status()).toBe(200);
      const inviteeAccessToken: string = (await inviteeLoginResponse.json()).access_token;
      expect(inviteeAccessToken).toBeTruthy();

      // Baseline: an ordinary active member (RBAC-2 grants no Permission on
      // invite/accept) gets 403 permission_denied from a permission-gated
      // route — never membership_inactive while active.
      const beforeSuspendResponse = await request.get(`/api/v1/orgs/${admin.orgId}/members`, {
        headers: { Authorization: `Bearer ${inviteeAccessToken}` },
      });
      expect(beforeSuspendResponse.status()).toBe(403);
      expect((await beforeSuspendResponse.json()).code).toBe("permission_denied");

      // 3. Back as the org_admin, suspend that member through the UI
      // (TC-RBAC-006 territory).
      await adminPage.reload();
      const inviteeRowAfterAccept = adminPage.getByRole("row").filter({ hasText: inviteeEmail });
      await expect(inviteeRowAfterAccept.getByText(/^active$/i)).toBeVisible();
      await inviteeRowAfterAccept.getByRole("button", { name: /suspend/i }).click();
      await expect(inviteeRowAfterAccept.getByText(/suspended/i)).toBeVisible();

      // 4. The suspended member's own session can no longer perform an
      // org-scoped authenticated action: the suspended-member gate now
      // fires (membership_inactive), strictly before the permission check
      // would even run (app/core/rbac.py's require_permission).
      const suspendedResponse = await request.get(`/api/v1/orgs/${admin.orgId}/members`, {
        headers: { Authorization: `Bearer ${inviteeAccessToken}` },
      });
      expect(suspendedResponse.status()).toBe(403);
      expect((await suspendedResponse.json()).code).toBe("membership_inactive");

      // 5. org_admin reactivates the member; access is restored immediately
      // (the membership gate no longer blocks — back to the pre-suspension
      // permission_denied, never membership_inactive again).
      await inviteeRowAfterAccept.getByRole("button", { name: /reactivate/i }).click();
      await expect(inviteeRowAfterAccept.getByText(/^active$/i)).toBeVisible();

      const reactivatedResponse = await request.get(`/api/v1/orgs/${admin.orgId}/members`, {
        headers: { Authorization: `Bearer ${inviteeAccessToken}` },
      });
      expect(reactivatedResponse.status()).toBe(403);
      expect((await reactivatedResponse.json()).code).toBe("permission_denied");
    } finally {
      await adminContext.close();
      await inviteeContext.close();
      cleanup(admin, inviteeEmail);
    }
  });
});
