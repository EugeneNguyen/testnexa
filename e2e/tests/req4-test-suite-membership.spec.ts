import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-4 E2E, browser UI (ADR-0030's frontend slice): real browser, full
 * stack, exercising `ProjectDetail.tsx`'s new "Test Suites" section plus the
 * TestCondition section's new TestCase sub-list — create a suite, add a
 * seeded TestCase to it via the "Add to suite" dropdown, expand the suite to
 * see the live membership, remove it, confirm it's gone. Complements (does
 * not replace) `test_req4_test_suite_membership.py`, which is the API-level
 * proof of TC-REQ-008..014 — this file is the actual click-through a human
 * (Priya) would do.
 *
 * Fixture seeding mirrors `req3-test-condition-rigor-path.spec.ts`: one
 * org_admin, one Organization, one Project, one Requirement, one
 * TestCondition (+ its RequirementTestConditionLink), one TestLevel/TestType,
 * and one TestCase already linked to that TestCondition (via
 * TestConditionTestCaseLink) so the "Add to suite" dropdown has something to
 * act on without also driving REQ-3's own create-a-TestCase flow here.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-req4-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  requirementId: string;
  testConditionId: string;
  testCaseId: string;
  testLevelId: string;
  testTypeId: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import Requirement, TestCase, TestCaseStatus, TestCondition, TestConditionPriority
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestConditionLink, TestConditionTestCaseLink

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-req4-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-4 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-4 UI E2E Org", slug=f"req4-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"REQ-4 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement = Requirement(
            project_id=project.id,
            title=f"REQ-4 UI E2E requirement {suffix}",
            description="Seeded for the REQ-4 test-suite-membership E2E spec",
        )
        session.add(requirement)
        await session.flush()

        condition = TestCondition(
            requirement_id=requirement.id,
            description=f"REQ-4 UI E2E condition {suffix}",
            priority=TestConditionPriority.medium,
        )
        session.add(condition)
        await session.flush()
        session.add(RequirementTestConditionLink(requirement_id=requirement.id, test_condition_id=condition.id))

        level = TestLevel(name=f"e2e-req4-level-{suffix}")
        test_type = TestType(name=f"e2e-req4-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        test_case = TestCase(
            test_condition_id=condition.id,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"REQ-4 UI E2E test case {suffix}",
            status=TestCaseStatus.draft,
        )
        session.add(test_case)
        await session.flush()
        session.add(TestConditionTestCaseLink(test_condition_id=condition.id, test_case_id=test_case.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "testConditionId": str(condition.id),
            "testCaseId": str(test_case.id),
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order: junction/link tables -> TestSuite/TestCase/TestCondition
// -> the rest, mirroring test_req4_test_suite_membership.py's cleanup helper.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestConditionLink, TestConditionTestCaseLink

user_id, org_id, project_id, requirement_id, test_condition_id, test_case_id, test_level_id, test_type_id = sys.argv[1:9]
test_suite_ids = json.loads(sys.argv[9]) if len(sys.argv) > 9 and sys.argv[9] else []

async def main():
    async with AsyncSessionLocal() as session:
        if test_suite_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(test_suite_ids)))
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(test_suite_ids)))
        await session.execute(delete(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_condition_id == test_condition_id))
        await session.execute(delete(RequirementTestConditionLink).where(RequirementTestConditionLink.test_condition_id == test_condition_id))
        await session.execute(delete(TestCase).where(TestCase.id == test_case_id))
        await session.execute(delete(TestCondition).where(TestCondition.id == test_condition_id))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(TestLevel).where(TestLevel.id == test_level_id))
        await session.execute(delete(TestType).where(TestType.id == test_type_id))
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

function cleanup(fixture: SeededFixture, testSuiteIds: string[]): void {
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
      fixture.testConditionId,
      fixture.testCaseId,
      fixture.testLevelId,
      fixture.testTypeId,
      JSON.stringify(testSuiteIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("REQ-4: organize TestCases into TestSuites through ProjectDetail's UI", () => {
  test("create a suite, add a test case to it, see it live, then remove it", async ({ page }) => {
    const fixture = seedFixture();
    const testSuiteIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      await expect(page.getByRole("heading", { name: /^test suites$/i })).toBeVisible();
      await expect(page.getByText(/no test suites yet/i)).toBeVisible();

      // --- Create a Test Suite via the generic factory route ----------------------
      await page.getByTestId("new-test-suite-btn").click();
      await expect(page.getByTestId("test-suite-modal")).toBeVisible();

      const suiteName = `REQ-4 UI E2E suite ${Date.now().toString(36)}`;
      await page.getByTestId("test-suite-name").fill(suiteName);
      await page.getByTestId("test-suite-purpose").fill("regression");

      const [suiteResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/test-suites") && response.request().method() === "POST",
        ),
        page.getByTestId("test-suite-submit").click(),
      ]);
      expect(suiteResponse.ok()).toBeTruthy();
      const createdSuite = await suiteResponse.json();
      testSuiteIds.push(createdSuite.id);

      await expect(page.getByTestId("test-suite-modal")).not.toBeVisible();
      const suiteRow = page.getByTestId(`test-suite-row-${createdSuite.id}`);
      await expect(suiteRow).toBeVisible();
      await expect(suiteRow).toContainText(suiteName);

      // --- Reveal the seeded TestCase via the Test Condition's sub-list -----------
      await page.getByTestId(`tc-section-toggle-${fixture.requirementId}`).click();
      await expect(page.getByTestId(`test-condition-row-${fixture.testConditionId}`)).toBeVisible();
      await page.getByTestId(`tc-cases-toggle-${fixture.testConditionId}`).click();
      const caseItem = page.getByTestId(`tc-case-item-${fixture.testCaseId}`);
      await expect(caseItem).toBeVisible();

      // --- Add it to the suite via the "Add to suite" dropdown --------------------
      await page.getByTestId(`add-to-suite-toggle-${fixture.testCaseId}`).click();
      const [addResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-suites/${createdSuite.id}/test-cases/${fixture.testCaseId}`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId(`add-to-suite-${fixture.testCaseId}-${createdSuite.id}`).click(),
      ]);
      expect(addResponse.ok()).toBeTruthy();
      // No inline error alert once the add succeeds.
      await expect(page.getByTestId(`add-to-suite-error-${fixture.testCaseId}`)).not.toBeVisible();

      // --- Expand the suite: membership is live, not a stale snapshot -------------
      await suiteRow.click();
      const memberRow = page.getByTestId(`suite-member-${createdSuite.id}-${fixture.testCaseId}`);
      await expect(memberRow).toBeVisible();
      await expect(page.getByTestId(`suite-membership-${createdSuite.id}`)).toContainText("draft");

      // --- Duplicate add while already a member -> 409, surfaced inline -----------
      await page.getByTestId(`add-to-suite-toggle-${fixture.testCaseId}`).click();
      const [dupeResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-suites/${createdSuite.id}/test-cases/${fixture.testCaseId}`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId(`add-to-suite-${fixture.testCaseId}-${createdSuite.id}`).click(),
      ]);
      expect(dupeResponse.status()).toBe(409);
      await expect(page.getByTestId(`add-to-suite-error-${fixture.testCaseId}`)).toContainText(
        /already in the suite/i,
      );

      // --- Remove it, confirm the live view reflects the removal immediately ------
      const [removeResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-suites/${createdSuite.id}/test-cases/${fixture.testCaseId}`) &&
            response.request().method() === "DELETE",
        ),
        page.getByTestId(`remove-from-suite-${createdSuite.id}-${fixture.testCaseId}`).click(),
      ]);
      expect(removeResponse.ok()).toBeTruthy();
      await expect(memberRow).not.toBeVisible();
      await expect(page.getByText(/no test cases in this suite yet/i)).toBeVisible();
    } finally {
      cleanup(fixture, testSuiteIds);
    }
  });
});
