import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * PROJ-2 E2E (ADR-0018): real browser, full stack, exercising
 * `ProjectDetail.tsx`'s "New Release" modal — an already-authenticated
 * org_admin creating a Project via `OrgHome.tsx`'s existing "New Project"
 * modal (reusing that flow inline, same as `project-create.spec.ts` itself
 * does — no exported helper exists in this codebase to import), navigating
 * to that project's detail page via the `OrgHome` project-list link (PROJ-2
 * scope item 4), then creating two Releases with distinct `target_date`s via
 * `ProjectDetail.tsx`'s own "New Release" modal and verifying both appear in
 * the release table sorted by `target_date` ascending (AC3/ADR-0018).
 *
 * Fixture seeding: a single human User who is org_admin (org-wide
 * RoleAssignment against RBAC-4's seeded `org_admin` system Role, which
 * grants `project.create`/`.read` and `release.create`/`.read` among
 * everything else) of one Organization, with exactly one active
 * `OrgMembership` — one active membership is what makes `POST /auth/login`
 * resolve `org_context: "auto"` (mirrors `auth-login.spec.ts`'s TC-AUTH
 * precondition and `Login.tsx`'s own `org_context === "auto" ->
 * navigate("/orgs/{orgs[0].id}")` redirect), landing straight on `OrgHome`
 * through real UI navigation — no raw `page.goto("/orgs/...")` needed.
 * Mirrors `project-create.spec.ts`'s conventions exactly (fixture seeding
 * via `docker exec ... python -` against the target env's own backend
 * container, FK-safe cleanup script, page-object-free role/label selectors).
 *
 * Target environment: the isolated test Compose project for this story
 * (`E2E_BASE_URL`, set externally per this task's brief), never the main
 * `testnexa` stack. Container name overridable via env var for portability.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-proj2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

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

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-proj2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="PROJ-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PROJ-2 E2E Org", slug=f"proj2-e2e-{suffix}")
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

// FK-safe delete order, mirroring `project-create.spec.ts`'s cleanup script,
// extended one level down the resource tree: `Release` rows are deleted by
// `project_id` membership rather than needing their own ids threaded through
// (the FK from `Release` to `Project` makes this safe/sufficient).
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project, Release
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id = sys.argv[1], sys.argv[2], sys.argv[3]
project_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        if project_ids:
            await session.execute(delete(Release).where(Release.project_id.in_(project_ids)))
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
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

function cleanup(admin: SeededOrgAdmin, projectIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      admin.email,
      admin.userId,
      admin.orgId,
      JSON.stringify(projectIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("PROJ-2: create Releases via ProjectDetail's New Release modal", () => {
  test("create a Project, navigate to its detail page, create two Releases, verify sorted order", async ({
    page,
  }) => {
    const admin = seedOrgAdmin();
    const projectIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(admin.email);
      await page.getByLabel(/password/i).fill(admin.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      // Single active OrgMembership -> org_context "auto" -> Login.tsx's own
      // redirect effect lands here automatically.
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}`));
      await expect(page.getByRole("heading", { name: `Org: ${admin.orgId}` })).toBeVisible();

      // --- Create a Project via OrgHome's "New Project" modal -----------------------------
      await page.getByRole("button", { name: /new project/i }).click();
      await expect(page.getByRole("heading", { name: /new project/i })).toBeVisible();

      const projectName = `PROJ-2 E2E Project ${Date.now().toString(36)}`;
      await page.getByLabel(/^name$/i).fill(projectName);

      const [createProjectResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/orgs/${admin.orgId}/projects`) && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createProjectResponse.ok()).toBeTruthy();
      const createdProject = await createProjectResponse.json();
      projectIds.push(createdProject.id);

      await expect(page.getByRole("heading", { name: /new project/i })).not.toBeVisible();

      // --- Navigate to the Project's detail page via the OrgHome link ---------------------
      await page.getByRole("link", { name: projectName }).click();
      await page.waitForURL(new RegExp(`/projects/${createdProject.id}`));
      await expect(page.getByRole("heading", { name: `Project: ${createdProject.id}` })).toBeVisible();
      await expect(page.getByText(/no releases yet/i)).toBeVisible();

      // --- Create two Releases with distinct target_dates, later date first ---------------
      const laterRelease = { versionLabel: `v2.0.0-${Date.now().toString(36)}`, targetDate: "2026-12-01" };
      const earlierRelease = { versionLabel: `v1.0.0-${Date.now().toString(36)}`, targetDate: "2026-10-01" };

      for (const release of [laterRelease, earlierRelease]) {
        await page.getByRole("button", { name: /new release/i }).click();
        await expect(page.getByRole("heading", { name: /new release/i })).toBeVisible();
        await page.getByLabel(/version label/i).fill(release.versionLabel);
        await page.getByLabel(/target date/i).fill(release.targetDate);

        const [createReleaseResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().includes(`/api/v1/projects/${createdProject.id}/releases`) &&
              response.request().method() === "POST",
          ),
          page.getByRole("button", { name: /^create$/i }).click(),
        ]);
        expect(createReleaseResponse.ok()).toBeTruthy();
        await expect(page.getByRole("heading", { name: /new release/i })).not.toBeVisible();
      }

      // --- Verify both appear, sorted by target_date ascending -----------------------------
      const rows = page.getByRole("row");
      // Row 0 is the header row; data rows follow in ascending target_date
      // order regardless of creation order (earlierRelease's 2026-10-01
      // sorts before laterRelease's 2026-12-01).
      await expect(rows.nth(1)).toContainText(earlierRelease.versionLabel);
      await expect(rows.nth(1)).toContainText(earlierRelease.targetDate);
      await expect(rows.nth(2)).toContainText(laterRelease.versionLabel);
      await expect(rows.nth(2)).toContainText(laterRelease.targetDate);
    } finally {
      cleanup(admin, projectIds);
    }
  });
});
