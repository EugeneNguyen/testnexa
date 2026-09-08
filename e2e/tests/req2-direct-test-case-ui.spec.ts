import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-2 E2E, browser UI (ADR-0006's frontend slice): real browser, full
 * stack, exercising `ProjectDetail.tsx`'s expanded-Requirement-row TestCase
 * section — creating a TestCase directly from a Requirement (no
 * TestCondition), then adding/editing its TestSteps.
 *
 * Covers TC-REQ-003/TC-REQ-004's UI path, complementing (not replacing) the
 * backend's own `test_req2_direct_test_case.py` integration suite, which
 * already proves the API round-trips correctly (atomic create + link, the
 * `resolve_test_case_org_id` fallback fix, pagination). This file is the
 * actual click-through a human (Priya) would do.
 *
 * Fixture seeding mirrors `req1-requirements-ui.spec.ts`: one org_admin of
 * one Organization/Project/Requirement, plus one TestLevel/TestType row
 * (global catalogs, no seed data ships with the scaffold — REQ-2's "New Test
 * Case" form needs at least one option in each `<select>`).
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-e2e-req2-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
  testLevelName: string;
  testTypeName: string;
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
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-req2-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-2 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-2 UI E2E Org", slug=f"req2-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"REQ-2 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement_title = f"REQ-2 UI E2E requirement {suffix}"
        requirement = Requirement(project_id=project.id, title=requirement_title, description="Seeded for REQ-2 UI E2E")
        session.add(requirement)
        await session.flush()

        test_level_name = f"E2E Level {suffix}"
        test_type_name = f"E2E Type {suffix}"
        session.add(TestLevel(name=test_level_name))
        session.add(TestType(name=test_type_name))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
            "testLevelName": test_level_name,
            "testTypeName": test_type_name,
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_req2_direct_test_case.py's `_cleanup` helper.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestStep
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

user_id, org_id, project_id, requirement_id, test_level_name, test_type_name = sys.argv[1:7]
test_case_ids = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else []

async def main():
    async with AsyncSessionLocal() as session:
        if test_case_ids:
            await session.execute(delete(TestStep).where(TestStep.test_case_id.in_(test_case_ids)))
            await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.test_case_id.in_(test_case_ids)))
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(TestLevel).where(TestLevel.name == test_level_name))
        await session.execute(delete(TestType).where(TestType.name == test_type_name))
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

function seedFixture(): SeededFixture {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededFixture;
}

function cleanup(fixture: SeededFixture, testCaseIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.userId,
      fixture.orgId,
      fixture.projectId,
      fixture.requirementId,
      fixture.testLevelName,
      fixture.testTypeName,
      JSON.stringify(testCaseIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("REQ-2: author a TestCase directly from a Requirement via ProjectDetail's UI", () => {
  test("create via the New Test Case modal under a Requirement, then add and edit TestSteps", async ({ page }) => {
    const fixture = seedFixture();
    const testCaseIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      const requirementRow = page.getByRole("row", { name: new RegExp(fixture.requirementTitle) });
      await expect(requirementRow).toBeVisible();

      // --- Expand the Requirement row -> "Test cases" section, empty state ------
      await requirementRow.click();
      await expect(page.getByRole("heading", { name: /^test cases$/i })).toBeVisible();
      await expect(page.getByText(/no test cases yet/i)).toBeVisible();

      // --- Create a TestCase via the "New Test Case" modal (direct link, ADR-0006) ---
      await page.getByRole("button", { name: /new test case/i }).click();
      await expect(page.getByRole("heading", { name: /new test case/i })).toBeVisible();

      const testCaseTitle = `REQ-2 UI E2E test case ${Date.now().toString(36)}`;
      await page.getByLabel(/^title$/i).fill(testCaseTitle);
      await page.getByLabel(/^expected result$/i).fill("System behaves as expected");
      await page.getByLabel(/test level/i).selectOption({ label: fixture.testLevelName });
      await page.getByLabel(/test type/i).selectOption({ label: fixture.testTypeName });

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/requirements/${fixture.requirementId}/test-cases`) &&
            response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const createdTestCase = await createResponse.json();
      testCaseIds.push(createdTestCase.id);
      expect(createdTestCase.test_condition_id).toBeNull();

      // Modal closes, new TestCase entry appears with status "draft".
      await expect(page.getByRole("heading", { name: /new test case/i })).not.toBeVisible();
      const testCaseEntry = page.getByText(`${testCaseTitle} — draft`, { exact: true });
      await expect(testCaseEntry).toBeVisible();

      // --- Expand the TestCase entry -> add TestSteps, ordered by sequence ------
      await testCaseEntry.click();
      await expect(page.getByText(/no steps yet/i)).toBeVisible();

      await page.getByLabel(/new step action/i).fill("Open login page");
      await page.getByRole("button", { name: /add step/i }).click();
      await expect(page.getByText("Open login page")).toBeVisible();

      await page.getByLabel(/new step action/i).fill("Submit credentials");
      await page.getByLabel(/new step expected result/i).fill("Redirected to dashboard");
      await page.getByRole("button", { name: /add step/i }).click();
      await expect(page.getByText("Submit credentials")).toBeVisible();

      // Ordered: "Open login page" (sequence 1) renders before "Submit credentials" (sequence 2).
      // Scoped to `ol.mb-2` (ProjectDetail's own TestSteps list), not a bare
      // `ol li` — AdminLTE's breadcrumb (AppBreadcrumb.tsx, raw HTML since
      // ADR-0037) is also a real `<ol class="breadcrumb my-0"><li>`, so an
      // unscoped locator picks up "Project" as a spurious third match.
      const stepItems = page.locator("ol.mb-2 li");
      await expect(stepItems).toHaveCount(2);
      await expect(stepItems.nth(0)).toContainText("Open login page");
      await expect(stepItems.nth(1)).toContainText("Submit credentials");

      // --- Independently editable: edit the first step alone --------------------
      await stepItems.nth(0).getByRole("button", { name: /^edit$/i }).click();
      const editAction = page.getByLabel(/step 1 action/i);
      await editAction.fill("Open the login page directly");
      await page.getByRole("button", { name: /^save$/i }).click();

      await expect(page.getByText("Open the login page directly")).toBeVisible();
      // Second step untouched by the first step's edit.
      await expect(page.getByText("Submit credentials")).toBeVisible();
    } finally {
      cleanup(fixture, testCaseIds);
    }
  });
});
