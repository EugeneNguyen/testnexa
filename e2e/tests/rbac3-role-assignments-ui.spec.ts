import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * RBAC-3 UI E2E (ADR-0021 addendum): real browser, full stack, exercising
 * `OrgHome.tsx`'s `RoleAssignmentsPanel` — the "New Role Assignment" modal
 * (role dropdown populated from the real `GET /orgs/{org_id}/roles`, `actor
 * id` as a raw UUID paste per the addendum's documented UI decision) and the
 * assignment table it renders into after a grant, for both an org-wide and
 * a project-scoped grant (TC-RBAC-038/039).
 *
 * Complements `rbac3-role-assignments.spec.ts` (API-only, proves the
 * backend enforcement semantics org-wide/project-scoped/AIAgent) — this spec
 * proves the *form* wiring: the role dropdown is real data, not a hardcoded
 * list, and a submitted grant round-trips through the real `POST` and shows
 * up in the table fetched via the real `GET`.
 *
 * Same fixture-seeding (`docker exec ... python -`) and FK-safe cleanup
 * convention as `project-create.spec.ts`/`rbac3-role-assignments.spec.ts`.
 *
 * Target environment: the isolated `testnexa-rbac3-test` Compose project
 * (`E2E_BASE_URL`), never the main `testnexa` stack. Container name
 * overridable via env var for portability.
 */

const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-rbac3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  admin: { email: string; password: string; userId: string };
  granteeOrgWide: { userId: string };
  granteeProjectScoped: { userId: string };
  orgId: string;
}

// Seeds a human org_admin (org-wide RoleAssignment, active OrgMembership) of
// a fresh Organization, plus two further Users with active OrgMembership and
// zero RoleAssignment rows — real actor ids to paste into the form. This
// spec creates the Project (via a direct API call, faster than driving the
// "New Project" modal again — PROJ-1's own spec already covers that flow)
// and both RoleAssignment grants through the UI itself, not seeded.
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

async def _create_user(session, tag):
    suffix = uuid4().hex[:8]
    email = f"e2e-rbac3-ui-{tag}-{suffix}@example.com"
    user = User(name=f"RBAC-3 UI E2E {tag}", email=email, password_hash=hash_password(PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    return user, email

async def main():
    async with AsyncSessionLocal() as session:
        admin, admin_email = await _create_user(session, "admin")

        org = Organization(name="RBAC-3 UI E2E Org", slug=f"rbac3-ui-e2e-{uuid4().hex[:8]}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        grantee_org_wide, _ = await _create_user(session, "grantee-org-wide")
        session.add(OrgMembership(org_id=org.id, user_id=grantee_org_wide.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        grantee_project_scoped, _ = await _create_user(session, "grantee-project-scoped")
        session.add(OrgMembership(org_id=org.id, user_id=grantee_project_scoped.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        await session.commit()
        print(json.dumps({
            "admin": {"email": admin_email, "password": PASSWORD, "userId": str(admin.actor_id)},
            "granteeOrgWide": {"userId": str(grantee_org_wide.actor_id)},
            "granteeProjectScoped": {"userId": str(grantee_project_scoped.actor_id)},
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring rbac3-role-assignments.spec.ts's CLEANUP_SCRIPT.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

admin_id, grantee_org_wide_id, grantee_project_scoped_id, org_id = sys.argv[1:5]
project_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        user_ids = [admin_id, grantee_org_wide_id, grantee_project_scoped_id]
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
        await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
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

function cleanup(fixture: SeededFixture, projectIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.admin.userId,
      fixture.granteeOrgWide.userId,
      fixture.granteeProjectScoped.userId,
      fixture.orgId,
      JSON.stringify(projectIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("RBAC-3 UI: Role Assignments panel on OrgHome", () => {
  test("grants org-wide and project-scoped roles via the form, role dropdown is real data (TC-RBAC-038/039)", async ({
    page,
    request,
  }) => {
    const fixture = seedFixture();
    const projectIds: string[] = [];

    try {
      // Create a Project directly via API — this spec is about the
      // role-assignment form, not the "New Project" modal (PROJ-1's own
      // spec already covers that).
      const loginForProjectCreate = await request.post("/api/v1/auth/login", {
        data: { email: fixture.admin.email, password: fixture.admin.password },
      });
      expect(loginForProjectCreate.ok()).toBeTruthy();
      const { access_token: setupToken } = await loginForProjectCreate.json();

      const projectResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/projects`, {
        headers: { Authorization: `Bearer ${setupToken}` },
        data: { name: `RBAC-3 UI E2E Project ${Date.now().toString(36)}` },
      });
      expect(projectResponse.ok()).toBeTruthy();
      const projectId: string = (await projectResponse.json()).id;
      projectIds.push(projectId);

      // --- Log in via the UI, land on OrgHome --------------------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.admin.email);
      await page.getByLabel(/password/i).fill(fixture.admin.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // The admin's own seeded org-wide `org_admin` grant plus the
      // project-just-created auto-grant (PROJ-1/ADR-0017: creator
      // unconditionally gets a project-scoped `test_manager` row) mean the
      // list is never actually empty here — wait for the real fetch to
      // resolve by asserting the admin's own org-wide row is already
      // present, rather than a wrong "no role assignments yet" expectation.
      await expect(page.getByRole("heading", { name: "Role Assignments" })).toBeVisible();
      const adminRow = page.getByRole("row", { name: new RegExp(fixture.admin.userId) });
      await expect(adminRow.first()).toBeVisible();

      // --- Org-wide grant -----------------------------------------------------------------
      await page.getByRole("button", { name: /new role assignment/i }).click();
      await expect(page.getByRole("heading", { name: /new role assignment/i })).toBeVisible();

      // Role dropdown is populated from the real GET /orgs/{org_id}/roles —
      // proves it's not a hardcoded list.
      const roleSelect = page.getByLabel(/^role$/i);
      await expect(roleSelect.locator("option", { hasText: "org_admin" })).toHaveCount(1);
      await expect(roleSelect.locator("option", { hasText: "tester" })).toHaveCount(1);

      await page.getByLabel(/^actor id$/i).fill(fixture.granteeOrgWide.userId);
      await roleSelect.selectOption({ label: "tester" });
      // Scope left at its default "Org-wide" — no project id field shown.
      await expect(page.getByLabel(/^project id$/i)).not.toBeVisible();

      const [orgWideResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/orgs/${fixture.orgId}/role-assignments`) &&
            response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^grant$/i }).click(),
      ]);
      expect(orgWideResponse.ok()).toBeTruthy();
      expect((await orgWideResponse.json()).project_id).toBeNull();

      await expect(page.getByRole("heading", { name: /new role assignment/i })).not.toBeVisible();
      const orgWideRow = page.getByRole("row", { name: new RegExp(fixture.granteeOrgWide.userId) });
      await expect(orgWideRow).toBeVisible();
      await expect(orgWideRow.getByText("tester")).toBeVisible();
      await expect(orgWideRow.getByText("Org-wide")).toBeVisible();

      // --- Project-scoped grant ------------------------------------------------------------
      await page.getByRole("button", { name: /new role assignment/i }).click();
      await page.getByLabel(/^actor id$/i).fill(fixture.granteeProjectScoped.userId);
      await page.getByLabel(/^role$/i).selectOption({ label: "org_admin" });
      await page.getByLabel(/^scope$/i).selectOption({ label: "Project-scoped" });

      const projectIdField = page.getByLabel(/^project id$/i);
      await expect(projectIdField).toBeVisible();
      await projectIdField.fill(projectId);

      const [projectScopedResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/orgs/${fixture.orgId}/role-assignments`) &&
            response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^grant$/i }).click(),
      ]);
      expect(projectScopedResponse.ok()).toBeTruthy();
      expect((await projectScopedResponse.json()).project_id).toBe(projectId);

      const projectScopedRow = page.getByRole("row", { name: new RegExp(fixture.granteeProjectScoped.userId) });
      await expect(projectScopedRow).toBeVisible();
      await expect(projectScopedRow.getByText("org_admin")).toBeVisible();
      await expect(projectScopedRow.getByText(`Project ${projectId}`)).toBeVisible();

      // --- Reload proves the list is real fetched data, not local state only -------------
      await page.reload();
      await expect(page.getByRole("row", { name: new RegExp(fixture.granteeOrgWide.userId) })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(fixture.granteeProjectScoped.userId) })).toBeVisible();
    } finally {
      cleanup(fixture, projectIds);
    }
  });
});
