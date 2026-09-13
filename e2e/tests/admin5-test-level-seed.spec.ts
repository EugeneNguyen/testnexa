import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADMIN-5 E2E (ADR-0066): the `TestCase` create form's "Test level" dropdown
 * (`ProjectDetail.tsx`'s "New Test Case" modal, `#testCaseTestLevel`) is
 * populated from the `test_level` catalog the new Alembic seed migration
 * inserts — not from a fixture this spec seeds itself.
 *
 * Deliberately does NOT seed a `TestLevel`/`TestType` row the way
 * `req2-direct-test-case-ui.spec.ts` does (that spec predates this seed and
 * needed at least one option in the dropdown to test with at all) — the
 * whole point of this spec is proving the dropdown is non-empty *without*
 * any test-local seeding, exactly the gap root `CLAUDE.md`'s "ship with
 * full CRUD but zero seeded rows" note (2026-09-06) used to describe.
 *
 * Does not submit the form (no `TestType` row exists to complete a real
 * create) — the claim under test is the dropdown's own content, not the
 * full create flow, which `req2-direct-test-case-ui.spec.ts` already covers.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-tlseed-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-admin5-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="ADMIN-5 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-5 E2E Org", slug=f"admin5-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-5 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement_title = f"ADMIN-5 E2E requirement {suffix}"
        requirement = Requirement(project_id=project.id, title=requirement_title, description="Seeded for ADMIN-5 E2E")
        session.add(requirement)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
        }))

asyncio.run(main())
`;

// FK-safe delete order — no TestCase/TestLevel/TestType rows to clean up
// (this spec never creates any), so this is a strict subset of
// `req2-direct-test-case-ui.spec.ts`'s own CLEANUP_SCRIPT.
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id, requirement_id = sys.argv[1:5]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(Project).where(Project.id == project_id))
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

const EXPECTED_ISTQB_TEST_LEVELS = [
  "Component Testing",
  "Component Integration Testing",
  "System Testing",
  "System Integration Testing",
  "Acceptance Testing",
];

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
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgId, fixture.projectId, fixture.requirementId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("ADMIN-5: TestLevel catalog is pre-seeded (ADR-0066)", () => {
  test("New Test Case modal's Test level dropdown lists exactly the 5 seeded ISTQB levels", async ({ page }) => {
    test.setTimeout(90000);
    const fixture = seedFixture();
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      const requirementRow = page.getByRole("row", { name: new RegExp(fixture.requirementTitle) });
      await expect(requirementRow).toBeVisible({ timeout: 20000 });

      // Expand the Requirement row -> "New Test Case" modal, no test-local
      // TestLevel seeding involved anywhere above this line.
      await requirementRow.click();
      await page.getByRole("button", { name: /new test case/i }).click();
      await expect(page.getByRole("heading", { name: /new test case/i })).toBeVisible({ timeout: 15000 });

      // `listTestLevels()` is fetched once at page-mount (`ProjectDetail.tsx`),
      // not re-triggered by opening this modal — the options populate
      // asynchronously shortly after mount, so `.allTextContents()` (a
      // one-shot, non-retrying read) can race a genuinely-correct render
      // that just hasn't landed yet. `toHaveCount` auto-retries; wait for
      // it before taking the one-shot content snapshot below.
      const testLevelSelect = page.getByLabel(/test level/i);
      const testLevelOptions = testLevelSelect.locator("option");
      await expect(testLevelOptions).toHaveCount(EXPECTED_ISTQB_TEST_LEVELS.length + 1, { timeout: 15000 });

      const optionLabels = await testLevelOptions.allTextContents();
      // Placeholder + exactly the 5 seeded names, no more, no fewer, no
      // test-authored fixture row mixed in.
      for (const name of EXPECTED_ISTQB_TEST_LEVELS) {
        expect(optionLabels).toContain(name);
      }
    } finally {
      cleanup(fixture);
    }
  });
});
