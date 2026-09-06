import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * PLAN-1 E2E, browser UI (ADR-0031 + the PLAN-1 UI Design Document): real
 * browser, full stack, exercising the new `TestPlanDetail` route end to end —
 * create a plan through the generic admin surface, reach it from
 * `ProjectDetail`'s new "Test Plans" list, include two suites, watch the
 * coverage query deduplicate a shared TestCase, get an illegal status
 * transition rejected inline, then walk the legal `draft -> approved ->
 * superseded` sequence.
 *
 * Complements (does not replace) `test_planning_test_plans.py`, which is the
 * API-level proof of TC-PLAN-001/002/003/009/010/011 — this file is the actual
 * click-through a human (Priya, the test manager persona) would do.
 *
 * The fixture is engineered for the deduplication claim, exactly as Test
 * Design §27 requires: suite A holds {shared, onlyA}, suite B holds {shared,
 * onlyB}. Once both suites are included, the correct coverage view shows THREE
 * rows with `shared` appearing once — a naive join-and-list would render four.
 * §27 is explicit that a single-suite fixture "cannot distinguish
 * 'deduplicated' from 'never had a duplicate to begin with'", so the shared
 * case is asserted by count, not just by presence.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls, per
 * `e2e/CLAUDE.md`.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-plan1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  suiteAId: string;
  suiteBId: string;
  sharedCaseId: string;
  onlyACaseId: string;
  onlyBCaseId: string;
  sharedCaseTitle: string;
  onlyACaseTitle: string;
  onlyBCaseTitle: string;
  suiteAName: string;
  suiteBName: string;
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
from app.models.assets import TestCase, TestCaseStatus, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    # example.com deliberately: never a reserved special-use TLD, which
    # POST /auth/login's EmailStr would 422 (backend/CLAUDE.md).
    email = f"e2e-plan1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="PLAN-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PLAN-1 E2E Org", slug=f"plan1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"PLAN-1 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        suite_a_name = f"PLAN-1 E2E Suite A {suffix}"
        suite_b_name = f"PLAN-1 E2E Suite B {suffix}"
        suite_a = TestSuite(project_id=project.id, name=suite_a_name, purpose="regression")
        suite_b = TestSuite(project_id=project.id, name=suite_b_name, purpose="smoke")
        session.add(suite_a)
        session.add(suite_b)

        level = TestLevel(name=f"e2e-plan1-level-{suffix}")
        test_type = TestType(name=f"e2e-plan1-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        def make_case(title):
            return TestCase(
                test_condition_id=None,
                test_level_id=level.id,
                test_type_id=test_type.id,
                created_by_actor_id=user.actor_id,
                title=title,
                status=TestCaseStatus.draft,
            )

        shared_title = f"PLAN-1 E2E SHARED case {suffix}"
        only_a_title = f"PLAN-1 E2E ONLY-A case {suffix}"
        only_b_title = f"PLAN-1 E2E ONLY-B case {suffix}"
        shared = make_case(shared_title)
        only_a = make_case(only_a_title)
        only_b = make_case(only_b_title)
        session.add(shared)
        session.add(only_a)
        session.add(only_b)
        await session.flush()

        # The engineered overlap: \`shared\` is a member of BOTH suites, so the
        # coverage query has a genuine duplicate to deduplicate (Test Design §27).
        session.add(TestSuiteTestCase(test_suite_id=suite_a.id, test_case_id=shared.id))
        session.add(TestSuiteTestCase(test_suite_id=suite_a.id, test_case_id=only_a.id))
        session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=shared.id))
        session.add(TestSuiteTestCase(test_suite_id=suite_b.id, test_case_id=only_b.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "suiteAId": str(suite_a.id),
            "suiteBId": str(suite_b.id),
            "sharedCaseId": str(shared.id),
            "onlyACaseId": str(only_a.id),
            "onlyBCaseId": str(only_b.id),
            "sharedCaseTitle": shared_title,
            "onlyACaseTitle": only_a_title,
            "onlyBCaseTitle": only_b_title,
            "suiteAName": suite_a_name,
            "suiteBName": suite_b_name,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order: junction tables -> TestPlan/TestSuite/TestCase ->
// taxonomy -> Project -> tenancy/actor, mirroring
// test_planning_test_plans.py's own `_cleanup` helper.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import TestPlan, TestPlanTestSuite
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id, test_level_id, test_type_id = sys.argv[1:6]
suite_ids = json.loads(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else []
case_ids = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else []
plan_ids = json.loads(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else []

async def main():
    async with AsyncSessionLocal() as session:
        if plan_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)))
        if suite_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_suite_id.in_(suite_ids)))
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)))
        # Sweep every plan scoped to this throwaway project, not just the ids
        # the spec captured — a run that failed midway may have created a plan
        # the spec never recorded, and leaking rows into the cloned DB would
        # poison later runs. Safe to do broadly: the project is created and
        # destroyed by this spec alone.
        # The junction rows are already gone via the suite_ids delete above:
        # cross-project includes are rejected (ADR-0031), so any plan in this
        # project can only reference this project's own (seeded) suites.
        await session.execute(delete(TestPlan).where(TestPlan.project_id == project_id))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        if case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(case_ids)))
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

function cleanup(fixture: SeededFixture, planIds: string[]): void {
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
      fixture.testLevelId,
      fixture.testTypeId,
      JSON.stringify([fixture.suiteAId, fixture.suiteBId]),
      JSON.stringify([fixture.sharedCaseId, fixture.onlyACaseId, fixture.onlyBCaseId]),
      JSON.stringify(planIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("PLAN-1: plan a test effort through the TestPlanDetail screen", () => {
  test("create a plan, include suites, see deduplicated coverage, and walk the status transitions", async ({
    page,
  }) => {
    const fixture = seedFixture();
    const planIds: string[] = [];
    try {
      // --- Log in --------------------------------------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- Create the TestPlan via the generic admin surface (TC-PLAN-001) -----
      // ADR-0031 leaves `POST /test-plans` entirely to ADR-0022's factory, so
      // this is deliberately the existing generic screen, not a new bespoke
      // create form — PLAN-1 adds no create UI of its own.
      await page.goto(`/projects/${fixture.projectId}/admin/test-plans`);
      await page.getByRole("button", { name: /^new$/i }).click();

      const planIdentifier = `PLAN-1 E2E Plan ${Date.now().toString(36)}`;
      await page.getByLabel(/identifier/i).fill(planIdentifier);
      await page.getByLabel(/^scope$/i).fill("Coverage for the PLAN-1 E2E release");
      await page.getByLabel(/status/i).selectOption("draft");

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/test-plans") && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.status()).toBe(201);
      const createdPlan = await createResponse.json();
      planIds.push(createdPlan.id);
      // AC1: created in `draft` by the column default, not by the client.
      expect(createdPlan.status).toBe("draft");

      // --- Reach it from ProjectDetail's new "Test Plans" list -----------------
      // UI Design Document §1: this section's rows LINK to the dedicated route
      // rather than expanding in place, the one deliberate departure from every
      // prior REQ-* section's pattern.
      await page.goto(`/projects/${fixture.projectId}`);
      const planRow = page.getByTestId(`test-plan-row-${createdPlan.id}`);
      await expect(planRow).toBeVisible();
      await expect(planRow).toContainText(planIdentifier);

      await planRow.getByRole("link", { name: planIdentifier }).click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/test-plans/${createdPlan.id}`),
      );

      // --- Empty states (UI Design Document §5, exact wording) -----------------
      await expect(page.getByTestId("test-plan-status")).toHaveText(/draft/i);
      await expect(page.getByText(/no test suites included yet/i)).toBeVisible();
      await expect(page.getByText(/no test cases covered yet/i)).toBeVisible();

      // --- Include suite A -----------------------------------------------------
      await page.getByTestId("include-suite-btn").click();
      await expect(page.getByTestId("include-suite-modal")).toBeVisible();
      await page.getByTestId("include-suite-select").selectOption(fixture.suiteAId);
      const [includeAResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-plans/${createdPlan.id}/test-suites/${fixture.suiteAId}`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId("include-suite-submit").click(),
      ]);
      expect(includeAResponse.status()).toBe(201);

      await expect(page.getByTestId(`included-suite-${fixture.suiteAId}`)).toContainText(
        fixture.suiteAName,
      );
      // Coverage re-fetched on include: suite A's two members are now covered.
      await expect(page.getByTestId(`covered-test-case-${fixture.sharedCaseId}`)).toBeVisible();
      await expect(page.getByTestId(`covered-test-case-${fixture.onlyACaseId}`)).toBeVisible();
      await expect(page.getByTestId(`covered-test-case-${fixture.onlyBCaseId}`)).toHaveCount(0);

      // --- Include suite B: the deduplication moment (TC-PLAN-002) -------------
      await page.getByTestId("include-suite-btn").click();
      await page.getByTestId("include-suite-select").selectOption(fixture.suiteBId);
      const [includeBResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-plans/${createdPlan.id}/test-suites/${fixture.suiteBId}`) &&
            response.request().method() === "POST",
        ),
        page.getByTestId("include-suite-submit").click(),
      ]);
      expect(includeBResponse.status()).toBe(201);

      await expect(page.getByTestId(`included-suite-${fixture.suiteBId}`)).toContainText(
        fixture.suiteBName,
      );
      await expect(page.getByTestId("included-suite-list").getByRole("listitem")).toHaveCount(2);

      // The union of both suites: 3 distinct cases, NOT 4 rows. `shared` belongs
      // to both included suites and must be rendered exactly once — the whole
      // point of the engineered fixture (Test Design §27).
      await expect(page.getByTestId(`covered-test-case-${fixture.onlyBCaseId}`)).toBeVisible();
      await expect(page.getByTestId(`covered-test-case-${fixture.sharedCaseId}`)).toHaveCount(1);
      await expect(page.getByTestId("coverage-list").getByRole("listitem")).toHaveCount(3);

      // --- Illegal transition: draft -> superseded is rejected (TC-PLAN-003) ---
      // UI Design Document §4: the 409 renders inline INSIDE the edit modal,
      // not as a toast and not silently reverted.
      await page.getByTestId("edit-test-plan-btn").click();
      await expect(page.getByTestId("edit-test-plan-modal")).toBeVisible();
      await page.getByLabel(/status/i).selectOption("superseded");
      const [illegalResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/test-plans/${createdPlan.id}`) &&
            response.request().method() === "PATCH",
        ),
        page.getByRole("button", { name: /^save$/i }).click(),
      ]);
      expect(illegalResponse.status()).toBe(409);
      expect((await illegalResponse.json()).code).toBe("invalid_status_transition");

      // The modal stays open with the error surfaced, and the plan is untouched.
      await expect(page.getByTestId("edit-test-plan-modal")).toBeVisible();
      await expect(page.getByTestId("edit-test-plan-modal").getByRole("alert")).toBeVisible();

      // --- Legal sequence: draft -> approved, then approved -> superseded ------
      await page.getByLabel(/status/i).selectOption("approved");
      const [approveResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/test-plans/${createdPlan.id}`) &&
            response.request().method() === "PATCH",
        ),
        page.getByRole("button", { name: /^save$/i }).click(),
      ]);
      expect(approveResponse.status()).toBe(200);
      await expect(page.getByTestId("test-plan-status")).toHaveText(/approved/i);

      await page.getByTestId("edit-test-plan-btn").click();
      await page.getByLabel(/status/i).selectOption("superseded");
      const [supersedeResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/v1/test-plans/${createdPlan.id}`) &&
            response.request().method() === "PATCH",
        ),
        page.getByRole("button", { name: /^save$/i }).click(),
      ]);
      expect(supersedeResponse.status()).toBe(200);
      await expect(page.getByTestId("test-plan-status")).toHaveText(/superseded/i);

      // --- Remove a suite: both sections re-fetch together ---------------------
      const [removeResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(`/api/v1/test-plans/${createdPlan.id}/test-suites/${fixture.suiteBId}`) &&
            response.request().method() === "DELETE",
        ),
        page.getByTestId(`remove-suite-${fixture.suiteBId}`).click(),
      ]);
      expect(removeResponse.status()).toBe(204);

      await expect(page.getByTestId(`included-suite-${fixture.suiteBId}`)).toHaveCount(0);
      // `onlyB` was reachable only through suite B, so coverage drops it;
      // `shared` survives because suite A still provides it.
      await expect(page.getByTestId(`covered-test-case-${fixture.onlyBCaseId}`)).toHaveCount(0);
      await expect(page.getByTestId(`covered-test-case-${fixture.sharedCaseId}`)).toHaveCount(1);
      await expect(page.getByTestId("coverage-list").getByRole("listitem")).toHaveCount(2);
    } finally {
      cleanup(fixture, planIds);
    }
  });
});
