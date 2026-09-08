import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * EXEC-3 E2E (ADR-0041, UI Design Document
 * `docs/ui-design/2026-09-08-exec-3-raise-defect-ui-design.md`).
 *
 * The one thing no lower test layer can prove: that raising a Defect through
 * a real browser on `TestCycleDetail` actually shows up, most-recent-first,
 * on the entirely different admin screen (`EntityFormPage`'s `test-case` edit
 * page) that AC3 names. Backend integration tests prove the two routes'
 * contracts in isolation; a Vitest test proves each component renders mocked
 * data. Neither proves the cross-screen round trip a real user experiences:
 * raise a defect on one screen, navigate away, land on a completely
 * different screen, and see it there.
 *
 * The flow, one test because every claim is sequential and shares one fixture:
 *
 * 1. Log in through the real login form (never a locally minted JWT — same
 *    posture every other EXEC-* spec takes).
 * 2. Reach `TestCycleDetail` by clicking `TestPlanDetail`'s cycle link.
 * 3. Record a `fail` result through the "Record Result" modal.
 * 4. The "Raise Defect" button appears on that `fail` row (and only that
 *    row — asserted against a second, `pass`-result row created in the same
 *    test, proving the button isn't unconditionally rendered).
 * 5. Raise a Defect through the modal (external_ref/severity/status).
 * 6. Record a second `fail` execution of the *same* TestCase and raise a
 *    second Defect — needed to prove AC3's "most recent first" as an actual
 *    ordering claim, not a single-row coincidence.
 * 7. Navigate to the TestCase's admin edit page
 *    (`/projects/:id/admin/test-cases/:id/edit`) and confirm both Defects
 *    render, most-recent-first, with the fields raised on `TestCycleDetail`.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls. Both must be
 * set together; the default below is this story's own stack and will not
 * exist in a later session (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-exec3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface ExecFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  testPlanId: string;
  testCycleId: string;
  testCycleName: string;
  testCaseId: string;
  testCaseTitle: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, one Project/Release/Environment/TestPlan, one TestSuite
 * *included* in the plan, one TestCase inside that suite, and one TestCycle.
 * Deliberately zero `TestExecution`/`Defect` rows — both must be ones the UI
 * itself creates. Identical in shape to `exec1-record-execution.spec.ts`'s/
 * `exec2-append-only-test-log.spec.ts`'s seed, same reasons (see those files'
 * own docstrings): included-suite membership is load-bearing for the
 * scope-check, `User(...)` is constructed directly (never `Actor()`-then-
 * `User(actor_id=...)`), and the email uses a real-shaped `@example.com`
 * domain.
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import TestCase, TestCaseStatus, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanStatus, TestPlanTestSuite
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-exec3-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="EXEC-3 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="EXEC-3 E2E Org", slug=f"exec3-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"EXEC-3 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        release = Release(project_id=project.id, version_label=f"exec3-rel-{suffix}", target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"exec3-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan_identifier = f"EXEC-3 E2E Plan {suffix}"
        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=plan_identifier,
            scope="Seeded for the EXEC-3 raise-Defect E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle_name = f"EXEC-3 E2E Cycle {suffix}"
        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_name,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        suite = TestSuite(project_id=project.id, name=f"exec3-suite-{suffix}")
        session.add(suite)
        await session.flush()

        # Load-bearing: this is what puts the TestCase in scope for the plan.
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))

        level = TestLevel(name=f"e2e-exec3-level-{suffix}")
        test_type = TestType(name=f"e2e-exec3-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        title = f"EXEC-3 test case {suffix}"
        case = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=title,
            status=TestCaseStatus.draft,
        )
        session.add(case)
        await session.flush()
        session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=case.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "testPlanId": str(plan.id),
            "testCycleId": str(cycle.id),
            "testCycleName": cycle_name,
            "testCaseId": str(case.id),
            "testCaseTitle": title,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup. Extends `exec2-append-only-test-log.spec.ts`'s
 * own cleanup shape with one more child layer: `Defect.test_execution_id` is
 * `ON DELETE RESTRICT` (Database Document §3.8/ADR-0041), so any `Defect`
 * raised in this spec must be deleted before its `TestExecution` parent —
 * before even `TestLog`, since deletion order only needs each RESTRICT-FK
 * child gone before its own parent, not a strict global ordering across
 * unrelated children. `TestCaseDefectLink` needs no explicit delete — its FK
 * to `defect.id` is `ON DELETE CASCADE` (Database Document §3.9).
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import Defect, TestExecution, TestLog
from app.models.planning import (
    EntryExitCriteria,
    Environment,
    TestCycle,
    TestPlan,
    TestPlanTestSuite,
)
from app.models.project import Project, Release
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3]
test_level_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []
test_type_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        plan_ids = (await session.execute(select(TestPlan.id).where(TestPlan.project_id == project_id))).scalars().all()
        suite_ids = (await session.execute(select(TestSuite.id).where(TestSuite.project_id == project_id))).scalars().all()
        cycle_ids = []
        if plan_ids:
            cycle_ids = (
                await session.execute(select(TestCycle.id).where(TestCycle.test_plan_id.in_(plan_ids)))
            ).scalars().all()

        if cycle_ids:
            execution_ids = (
                await session.execute(
                    select(TestExecution.id).where(TestExecution.test_cycle_id.in_(cycle_ids))
                )
            ).scalars().all()
            if execution_ids:
                # EXEC-3: Defect before TestExecution (RESTRICT). TestCaseDefectLink
                # cascades away with its Defect, no separate delete needed.
                await session.execute(delete(Defect).where(Defect.test_execution_id.in_(execution_ids)))
                # EXEC-2: TestLog before TestExecution (RESTRICT).
                await session.execute(delete(TestLog).where(TestLog.test_execution_id.in_(execution_ids)))
            await session.execute(delete(TestExecution).where(TestExecution.test_cycle_id.in_(cycle_ids)))
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(cycle_ids)))

        if suite_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)))
        if plan_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)))
            await session.execute(delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(plan_ids)))

        await session.execute(delete(TestCase).where(TestCase.created_by_actor_id == user_id))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        if plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(plan_ids)))

        await session.execute(delete(Environment).where(Environment.project_id == project_id))
        await session.execute(delete(Release).where(Release.project_id == project_id))

        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))

        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.commit()

asyncio.run(main())
`;

function runBackendPython<T>(script: string, args: string[] = []): T {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-", ...args], {
    input: script,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as T;
}

function cleanup(
  fixture: { userId: string; orgId: string; projectId: string },
  testLevelIds: string[] = [],
  testTypeIds: string[] = [],
): void {
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
      JSON.stringify(testLevelIds),
      JSON.stringify(testTypeIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("EXEC-3: raise a Defect from a failed TestExecution", () => {
  test("raises two defects on TestCycleDetail, both appear most-recent-first on the TestCase's admin edit page", async ({
    page,
  }) => {
    // Default 30s is tight for this flow (2 result recordings + 2 raise-defect
    // round trips + a final cross-screen navigation, on top of the usual
    // cold-Vite-transform cost every EXEC-* spec's first page load pays).
    test.setTimeout(90000);
    const fixture = runBackendPython<ExecFixture>(SEED_SCRIPT);
    try {
      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- Reach the cycle by clicking the link, not by goto -------------------
      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`);
      await expect(page.getByRole("heading", { name: /^test cycles$/i })).toBeVisible();
      const cycleLink = page.getByTestId(`open-test-cycle-${fixture.testCycleId}`);
      await expect(cycleLink).toHaveText(fixture.testCycleName, { timeout: 15000 });
      await cycleLink.click();
      await page.waitForURL(
        new RegExp(
          `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}/test-cycles/${fixture.testCycleId}`,
        ),
      );
      await expect(page.getByTestId("test-cycle-name")).toHaveText(fixture.testCycleName);

      // --- Record a fail result -------------------------------------------------
      async function recordResult(result: "pass" | "fail") {
        await page.getByTestId("record-result-btn").click();
        await expect(page.getByTestId("record-result-modal")).toBeVisible();
        const pickerWrapper = page.getByTestId("record-result-test-case");
        const pickerInput = pickerWrapper.locator("#recordTestCaseId");
        await expect(pickerInput).toBeEnabled();
        await pickerInput.fill(fixture.testCaseTitle.slice(0, 12));
        const caseOption = pickerWrapper.getByRole("button", {
          name: fixture.testCaseTitle,
          exact: true,
        });
        await expect(caseOption).toBeVisible();
        await caseOption.click();
        await expect(pickerInput).toHaveValue(fixture.testCaseTitle);
        await page.getByTestId("record-result-select").selectOption(result);
        await page.getByTestId("record-executed-at").fill("2026-09-08T09:00");
        await page.getByTestId("record-result-submit").click();
        await expect(page.getByTestId("record-result-modal")).toBeHidden({ timeout: 15000 });
      }

      await recordResult("fail");
      const historyItems = page.getByTestId("execution-history-list").getByRole("listitem");
      await expect(historyItems).toHaveCount(1);
      const failRowTestId = await historyItems.first().getAttribute("data-testid");
      const failExecutionId = failRowTestId!.replace(/^execution-/, "");

      // --- "Raise Defect" only on the fail row (a second, pass row proves it) --
      await recordResult("pass");
      await expect(historyItems).toHaveCount(2);
      await expect(page.getByTestId(`execution-${failExecutionId}-raise-defect`)).toBeVisible();
      const passRow = historyItems.filter({ hasText: "pass" }).first();
      const passRowTestId = await passRow.getAttribute("data-testid");
      const passExecutionId = passRowTestId!.replace(/^execution-/, "");
      await expect(page.getByTestId(`execution-${passExecutionId}-raise-defect`)).toHaveCount(0);

      // --- Raise the first Defect ------------------------------------------------
      await page.getByTestId(`execution-${failExecutionId}-raise-defect`).click();
      await expect(page.getByTestId("raise-defect-modal")).toBeVisible();
      await page.getByTestId("raise-defect-external-ref").fill("JIRA-1001");
      await page.getByTestId("raise-defect-severity").selectOption("high");
      await page.getByTestId("raise-defect-submit").click();
      await expect(page.getByTestId("raise-defect-modal")).toBeHidden({ timeout: 15000 });

      // --- A second fail execution + a second Defect, to prove real ordering ---
      await recordResult("fail");
      await expect(historyItems).toHaveCount(3);
      const secondFailRow = historyItems.filter({ hasText: "fail" }).nth(0);
      const secondFailRowTestId = await secondFailRow.getAttribute("data-testid");
      const secondFailExecutionId = secondFailRowTestId!.replace(/^execution-/, "");

      await page.getByTestId(`execution-${secondFailExecutionId}-raise-defect`).click();
      await expect(page.getByTestId("raise-defect-modal")).toBeVisible();
      await page.getByTestId("raise-defect-external-ref").fill("JIRA-1002");
      await page.getByTestId("raise-defect-severity").selectOption("critical");
      await page.getByTestId("raise-defect-status").fill("investigating");
      await page.getByTestId("raise-defect-submit").click();
      await expect(page.getByTestId("raise-defect-modal")).toBeHidden({ timeout: 15000 });

      // --- Navigate to a COMPLETELY DIFFERENT screen and find both defects -----
      // The cross-screen round trip: AC3's own literal claim ("TestCase's
      // detail view shows all Defects... most recent first") can only be
      // proven by actually landing on that other screen, not by staying on
      // TestCycleDetail (which never renders a Defects list of its own).
      await page.goto(`/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}/edit`);
      const defectsList = page.getByTestId("test-case-defects-list");
      await expect(defectsList).toBeVisible({ timeout: 15000 });
      const defectRows = defectsList.getByRole("listitem");
      await expect(defectRows).toHaveCount(2);

      // Most recent first: the second-raised Defect (JIRA-1002) is row 0.
      await expect(defectRows.nth(0)).toContainText("critical");
      await expect(defectRows.nth(0)).toContainText("JIRA-1002");
      await expect(defectRows.nth(0)).toContainText("investigating");
      await expect(defectRows.nth(1)).toContainText("high");
      await expect(defectRows.nth(1)).toContainText("JIRA-1001");
      await expect(defectRows.nth(1)).toContainText("open");
    } finally {
      cleanup(fixture, [fixture.testLevelId], [fixture.testTypeId]);
    }
  });
});
