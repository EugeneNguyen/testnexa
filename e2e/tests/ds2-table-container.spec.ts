import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * DS-2 E2E ([ADR-0041](../../docs/adr/0041-ds-2-table-container-shared-pagination.md)):
 * real browser, full stack, exercising the shared `container/Table.tsx`
 * against two of its migrated consumers — `ProjectDetail`'s Releases table
 * (server mode) and `OrgHome`/Dashboard's Project table (client mode) — plus
 * TC-DS-017's nested-table ARIA-exclusion boundary, which only a real
 * browser's accessible-name computation (not Vitest/jsdom) can prove.
 *
 * Seeding/cleanup mirrors `release-create.spec.ts`'s established pattern
 * (`docker exec ... python -`, FK-safe cleanup) — extended to seed enough
 * `Release`/`Project` rows directly via the ORM to force real pagination,
 * since walking the "New Release"/"New Project" UI modal 12+ times per test
 * would be slow and is not what this spec is proving.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-ds2-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  releaseIds: string[];
  extraProjectIds: string[];
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-ds2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="DS-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="DS-2 E2E Org", slug=f"ds2-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        # Primary project with 28 Releases -- exceeds the default page size
        # (25), so the pagination row (and the page-size selector, which the
        # container only renders alongside it) is visible immediately.
        project = Project(org_id=org.id, name=f"DS-2 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        release_ids = []
        base_date = date(2026, 1, 1)
        for i in range(28):
            release = Release(
                project_id=project.id,
                version_label=f"v1.{i}.0-{suffix}",
                target_date=base_date + timedelta(days=i),
            )
            session.add(release)
            await session.flush()
            release_ids.append(str(release.id))

        # 12 more Projects in the same org -- forces OrgHome/Dashboard's
        # client-mode pagination the same way, at the default page size (10).
        extra_project_ids = []
        for i in range(12):
            p = Project(org_id=org.id, name=f"DS-2 E2E Extra Project {i:02d}-{suffix}")
            session.add(p)
            await session.flush()
            extra_project_ids.append(str(p.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "releaseIds": release_ids,
            "extraProjectIds": extra_project_ids,
        }))

asyncio.run(main())
`;

const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project, Release
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
extra_project_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(Release).where(Release.project_id == project_id))
        all_project_ids = [project_id, *extra_project_ids]
        await session.execute(delete(Project).where(Project.id.in_(all_project_ids)))
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
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.email,
      fixture.userId,
      fixture.orgId,
      fixture.projectId,
      JSON.stringify(fixture.extraProjectIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("DS-2: shared Table container", () => {
  test("ProjectDetail Releases (server mode): page-size selector, pagination, and nested TestCycle list stays ARIA-unambiguous (TC-DS-017)", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      await expect(page.getByRole("heading", { name: `Project: ${fixture.projectId}` })).toBeVisible();

      // 28 releases > the default page size (25) -- pagination (and the
      // page-size selector alongside it) is visible immediately.
      await expect(page.getByTestId("release-table-pagination")).toBeVisible();
      await expect(page.getByRole("row")).toHaveCount(26); // header + 25 data rows

      // Switch to the smallest page size -- 28 rows / 10 = 3 pages.
      await page.getByTestId("release-table-page-size").selectOption("10");
      await expect(page.getByTestId("release-table-pagination")).toBeVisible();
      await expect(page.getByRole("row")).toHaveCount(11); // header + 10 data rows, reset to page 1

      await page.getByText("3", { exact: true }).click();
      await expect(page.getByRole("row")).toHaveCount(9); // header + 8 remaining data rows (28 - 20)

      // Back to page 1, then expand a release row to render its nested
      // Release -> TestCycle <ul>/<li> audit view (frontend/CLAUDE.md's
      // no-nested-<CTable> rule) inside the same outer table the container
      // now drives.
      await page.getByText("1", { exact: true }).click();
      const firstRow = page.getByRole("row").nth(1);
      const versionLabelText = (await firstRow.locator("td").first().innerText()).trim();
      await firstRow.click();

      // TC-DS-017: this lookup must resolve to exactly ONE row. If the
      // nested TestCycle view were ever a <CTable> instead of the required
      // flat <ul>/<li>, the outer row's own accessible name would aggregate
      // the inner content and this becomes a Playwright strict-mode
      // violation (throws on .click()/.textContent()) instead of a clean
      // single match here.
      await expect(page.getByRole("row", { name: versionLabelText })).toHaveCount(1);

      // The nested content itself really is a <ul>, not a second table.
      const expandedCell = page.locator("td.bg-body-tertiary");
      await expect(expandedCell.locator("table")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  test("OrgHome/Dashboard Project table (client mode): page-size selector paginates the already-fetched list", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

      // 13 total projects (1 primary + 12 extra), default page size 10 ->
      // pagination visible immediately, unlike the server-mode case above.
      // Scoped to the Project table specifically (the page's first table) --
      // the seeded org_admin's own auto-granted org-wide RoleAssignment
      // means `RoleAssignmentsPanel`'s table below it has 1 row of its own,
      // which an unscoped `page.getByRole("row")` would also pick up.
      const projectTable = page.getByRole("table").first();
      await expect(page.getByTestId("project-table-pagination")).toBeVisible();
      await expect(projectTable.getByRole("row")).toHaveCount(11); // header + 10 data rows

      await page.getByTestId("project-table-page-size").selectOption("25");
      // All 13 fit on one page now -- pagination row disappears.
      await expect(page.getByTestId("project-table-pagination")).not.toBeVisible();
      await expect(projectTable.getByRole("row")).toHaveCount(14); // header + 13 data rows
    } finally {
      cleanup(fixture);
    }
  });
});
