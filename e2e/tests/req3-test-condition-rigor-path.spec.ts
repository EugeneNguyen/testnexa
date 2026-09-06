import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-3 E2E, browser UI (ADR-0028's frontend slice): real browser, full
 * stack, exercising `ProjectDetail.tsx`'s new per-Requirement "Test
 * Conditions" section — expand a Requirement, create a TestCondition via
 * the bespoke `POST /requirements/{id}/test-conditions` route, then create
 * a TestCase under it via the bespoke `POST /test-conditions/{id}/test-cases`
 * route. Complements (does not replace) `test_req3_test_condition_authoring.py`,
 * which is the API-level proof both routes write their link rows correctly —
 * this file is the actual click-through a human (Marcus) would do.
 *
 * Fixture seeding mirrors `req1-requirements-ui.spec.ts`: one org_admin,
 * one Organization, one Project, plus (REQ-3-specific) one Requirement and
 * one TestLevel/TestType row so the TestCase modal's selects aren't empty.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-req3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  requirementId: string;
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
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-req3-ui-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-3 UI E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-3 UI E2E Org", slug=f"req3-ui-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"REQ-3 UI E2E Project {suffix}")
        session.add(project)
        await session.flush()

        requirement = Requirement(
            project_id=project.id,
            title=f"REQ-3 UI E2E requirement {suffix}",
            description="Seeded for the REQ-3 rigor-path E2E spec",
        )
        session.add(requirement)

        level = TestLevel(name=f"e2e-req3-level-{suffix}")
        test_type = TestType(name=f"e2e-req3-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order: link tables -> TestCase/TestCondition -> the rest,
// mirroring `test_req3_test_condition_authoring.py`'s `_cleanup` helper.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestCondition
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestConditionLink, TestConditionTestCaseLink

user_id, org_id, project_id, requirement_id, test_level_id, test_type_id = sys.argv[1:7]
test_condition_ids = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else []
test_case_ids = json.loads(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else []

async def main():
    async with AsyncSessionLocal() as session:
        if test_condition_ids:
            await session.execute(
                delete(TestConditionTestCaseLink).where(TestConditionTestCaseLink.test_condition_id.in_(test_condition_ids))
            )
            await session.execute(
                delete(RequirementTestConditionLink).where(RequirementTestConditionLink.test_condition_id.in_(test_condition_ids))
            )
        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_condition_ids:
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(test_condition_ids)))
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

function cleanup(fixture: SeededFixture, testConditionIds: string[], testCaseIds: string[]): void {
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
      fixture.testLevelId,
      fixture.testTypeId,
      JSON.stringify(testConditionIds),
      JSON.stringify(testCaseIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("REQ-3: author a TestCase via the rigor path (TestCondition layer) through ProjectDetail's UI", () => {
  test("expand a Requirement, create a Test Condition, create a Test Case under it", async ({ page }) => {
    const fixture = seedFixture();
    const testConditionIds: string[] = [];
    const testCaseIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await page.goto(`/projects/${fixture.projectId}`);
      await expect(page.getByRole("heading", { name: /^requirements$/i })).toBeVisible();

      // --- Expand the seeded Requirement's "Test Conditions" section --------------
      await page.getByTestId(`tc-section-toggle-${fixture.requirementId}`).click();
      await expect(page.getByText(/no test conditions yet/i)).toBeVisible();

      // --- Create a Test Condition via the bespoke atomic-create route ------------
      await page.getByTestId(`new-test-condition-btn-${fixture.requirementId}`).click();
      await expect(page.getByTestId("test-condition-modal")).toBeVisible();

      const description = `REQ-3 UI E2E test condition ${Date.now().toString(36)}`;
      await page.getByTestId("test-condition-description").fill(description);
      await page.getByTestId("test-condition-priority").selectOption("high");

      const [conditionResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/requirements/${fixture.requirementId}/test-conditions`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId("test-condition-submit").click(),
      ]);
      expect(conditionResponse.ok()).toBeTruthy();
      const createdCondition = await conditionResponse.json();
      testConditionIds.push(createdCondition.id);

      // Modal closes, new row appears with the submitted values.
      await expect(page.getByTestId("test-condition-modal")).not.toBeVisible();
      const conditionRow = page.getByTestId(`test-condition-row-${createdCondition.id}`);
      await expect(conditionRow).toBeVisible();
      await expect(conditionRow.getByText(description)).toBeVisible();
      await expect(conditionRow.getByText(/high/i)).toBeVisible();

      // --- Create a Test Case under that Test Condition ----------------------------
      await page.getByTestId(`new-test-case-btn-${createdCondition.id}`).click();
      await expect(page.getByTestId("test-case-modal")).toBeVisible();

      const title = `REQ-3 UI E2E test case ${Date.now().toString(36)}`;
      await page.getByTestId("test-case-title").fill(title);
      await page.getByTestId("test-case-preconditions").fill("Seeded fixture is in a known state");
      await page.getByTestId("test-case-expected-result").fill("Test case is linked to its Test Condition");
      await page.getByTestId("test-case-test-level").selectOption(fixture.testLevelId);
      await page.getByTestId("test-case-test-type").selectOption(fixture.testTypeId);

      const [caseResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/test-conditions/${createdCondition.id}/test-cases`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId("test-case-submit").click(),
      ]);
      expect(caseResponse.ok()).toBeTruthy();
      const createdCase = await caseResponse.json();
      testCaseIds.push(createdCase.id);
      expect(createdCase.test_condition_id).toBe(createdCondition.id);

      // Modal closes, success toast confirms the link.
      await expect(page.getByTestId("test-case-modal")).not.toBeVisible();
      await expect(page.getByTestId("test-case-created-toast")).toBeVisible();
    } finally {
      cleanup(fixture, testConditionIds, testCaseIds);
    }
  });
});
