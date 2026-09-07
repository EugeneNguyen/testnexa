import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * EXEC-1 E2E (ADR-0034, UI Design Document
 * `docs/ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md`).
 *
 * One spec, driven entirely through the real browser against the real stack —
 * this is the layer PLAN-3's own execution spec explicitly could not cover
 * ("there is no frontend execution-recording form (that's EXEC-1), so there is
 * nothing to click"). Now there is.
 *
 * The flow, in one test because the claims are sequential and share a fixture:
 *
 * 1. Log in through the real login form (never a locally minted JWT — same
 *    posture `plan3-test-cycle.spec.ts`/`project-create.spec.ts` take).
 * 2. Reach `TestCycleDetail` **by clicking the new link** on `TestPlanDetail`'s
 *    Test Cycles row, not by `page.goto`. Those rows were deliberate dead ends
 *    before this story, so the link itself is new behavior worth exercising —
 *    a `goto` would pass even if the link were never wired up.
 * 3. Assert the zero state: all four tiles render `0` (not blank, not hidden —
 *    UI Design Document §3), and the history shows its empty message.
 * 4. Record a `pass` -> the Pass tile becomes `1` **live**, from a real refetch
 *    against the server, and one row appears in the history.
 * 5. Record a **second** result for the *same* `TestCase` (`fail`) ->
 *    TC-EXEC-003 at the UI layer: two rows in the history, the first one still
 *    showing its own original result and notes, and the tiles now reading
 *    Pass=1 **and** Fail=1 rather than one value having been overwritten.
 *
 * Step 5 is the part a naive "record twice, see two rows" test would get wrong.
 * Asserting only the row count would pass against an implementation that
 * overwrote the first execution and happened to render a second row from stale
 * state, so the *first* row's own result badge and notes are asserted to be
 * unchanged, and the dashboard is asserted to show both values at once.
 *
 * The final assertion drops to the database directly: two distinct
 * `TestExecution` rows for the one `(test_cycle_id, test_case_id)` pair. What
 * renders on screen cannot, on its own, distinguish two real rows from one row
 * displayed twice.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/verify/cleanup `docker exec` calls. Both must
 * be set together; the defaults below are a prior session's names and will not
 * exist (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-exec1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface ExecFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  releaseId: string;
  testPlanId: string;
  testPlanIdentifier: string;
  environmentId: string;
  testCycleId: string;
  testCycleName: string;
  includedSuiteId: string;
  testCaseId: string;
  testCaseTitle: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, one Project/Release/Environment/TestPlan, one TestSuite
 * *included* in the plan, one TestCase inside that suite, and one TestCycle.
 * Deliberately **zero** `TestExecution` rows — the dashboard's four-`0` zero
 * state is one of the things under test, and every execution in this spec must
 * be one the UI itself created.
 *
 * The included-suite membership is load-bearing, not incidental: without it the
 * `TestCase` is out of scope for the plan and both recordings would be rejected
 * by ADR-0033's `422` scope check, so the picker would offer nothing.
 *
 * `User(name=..., email=..., password_hash=...)` is constructed *directly* —
 * never `Actor()` then `User(actor_id=...)`, which breaks the joined-table
 * mapper's identity tracking (`backend/CLAUDE.md`). The email uses a
 * real-shaped `@example.com` domain: `POST /auth/login`'s `EmailStr` rejects
 * the IANA reserved TLDs (`.local`/`.test`/`.invalid`/`.example`) with a 422
 * that reads exactly like a wrong password.
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
    email = f"e2e-exec1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="EXEC-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="EXEC-1 E2E Org", slug=f"exec1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"EXEC-1 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        release = Release(project_id=project.id, version_label=f"exec1-rel-{suffix}", target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"exec1-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan_identifier = f"EXEC-1 E2E Plan {suffix}"
        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=plan_identifier,
            scope="Seeded for the EXEC-1 execution-recording E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle_name = f"EXEC-1 E2E Cycle {suffix}"
        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_name,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        suite = TestSuite(project_id=project.id, name=f"exec1-suite-{suffix}")
        session.add(suite)
        await session.flush()

        # Load-bearing: this is what puts the TestCase in scope for the plan.
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))

        level = TestLevel(name=f"e2e-exec1-level-{suffix}")
        test_type = TestType(name=f"e2e-exec1-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        title = f"EXEC-1 covered test case {suffix}"
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
            "releaseId": str(release.id),
            "testPlanId": str(plan.id),
            "testPlanIdentifier": plan_identifier,
            "environmentId": str(environment.id),
            "testCycleId": str(cycle.id),
            "testCycleName": cycle_name,
            "includedSuiteId": str(suite.id),
            "testCaseId": str(case.id),
            "testCaseTitle": title,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * The database-level half of TC-EXEC-003: how many distinct `TestExecution`
 * rows exist for this one `(test_cycle_id, test_case_id)` pair, and what each
 * holds. Two rendered rows cannot, by themselves, prove two stored rows — an
 * upsert that returned a fresh id would look identical on screen.
 */
const VERIFY_EXECUTIONS_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.execution import TestExecution

cycle_id, case_id = sys.argv[1], sys.argv[2]

async def main():
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(TestExecution)
                .where(TestExecution.test_cycle_id == cycle_id, TestExecution.test_case_id == case_id)
                .order_by(TestExecution.executed_at)
            )
        ).scalars().all()
        print(json.dumps({
            "count": len(rows),
            "ids": [str(row.id) for row in rows],
            "results": [row.result.value if hasattr(row.result, "value") else row.result for row in rows],
            "actualResults": [row.actual_result for row in rows],
            "executedByActorIds": [str(row.executed_by_actor_id) for row in rows],
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup taking `(user_id, org_id, project_id,
 * test_level_ids, test_type_ids)` as `sys.argv`. Same shape and ordering as
 * `plan3-test-cycle.spec.ts`'s, and for the same reason: `TestExecution`'s and
 * `TestCycle`'s FKs are all `ondelete="RESTRICT"`, so executions must go before
 * cycles, and cycles before plans/releases/environments.
 *
 * Executions are found via the cycle ids rather than passed in — every one of
 * them is created by the *UI* during the test, so their ids are never known to
 * this script's caller.
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution
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

test.describe("EXEC-1: record a TestExecution through TestCycleDetail", () => {
  test("records a result, sees the dashboard update live, and re-recording preserves history", async ({
    page,
  }) => {
    const fixture = runBackendPython<ExecFixture>(SEED_SCRIPT);
    try {
      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // --- Reach the cycle BY CLICKING the new link, not by goto --------------
      // Those rows were dead ends before EXEC-1, so the link is itself new
      // behavior; a `page.goto` would pass even with the link never wired up.
      await page.goto(`/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`);
      await expect(page.getByRole("heading", { name: /^test cycles$/i })).toBeVisible();
      const cycleLink = page.getByTestId(`open-test-cycle-${fixture.testCycleId}`);
      await expect(cycleLink).toHaveText(fixture.testCycleName);
      await cycleLink.click();
      await page.waitForURL(
        new RegExp(
          `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}/test-cycles/${fixture.testCycleId}`,
        ),
      );

      // --- The zero state ------------------------------------------------------
      await expect(page.getByTestId("test-cycle-name")).toHaveText(fixture.testCycleName);
      await expect(page.getByTestId("test-cycle-load-error")).toHaveCount(0);
      await expect(page.getByTestId("dashboard-error")).toHaveCount(0);

      const passCount = page.getByTestId("dashboard-tile-pass-count");
      const failCount = page.getByTestId("dashboard-tile-fail-count");
      const blockedCount = page.getByTestId("dashboard-tile-blocked-count");
      const skippedCount = page.getByTestId("dashboard-tile-skipped-count");

      // §3: all four always render, `0` included — never blank or hidden.
      await expect(passCount).toHaveText("0");
      await expect(failCount).toHaveText("0");
      await expect(blockedCount).toHaveText("0");
      await expect(skippedCount).toHaveText("0");
      await expect(page.getByText(/no executions recorded yet\./i)).toBeVisible();

      // --- Record #1: a `pass` -------------------------------------------------
      await page.getByTestId("record-result-btn").click();
      await expect(page.getByTestId("record-result-modal")).toBeVisible();

      // The TestCase picker is an FkAutocomplete scoped to the plan's own
      // coverage query — type, then click the offered option (TC-EXEC-010's
      // subject; only in-scope cases can appear here at all).
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

      await page.getByTestId("record-result-select").selectOption("pass");
      await page.getByTestId("record-actual-result").fill("Behaved as expected.");
      // Explicit, and earlier than record #2's, so the descending order the
      // history claims is actually determined rather than clock-dependent.
      await page.getByTestId("record-executed-at").fill("2026-09-07T09:00");
      await page.getByTestId("record-result-submit").click();

      await expect(page.getByTestId("record-result-modal")).toBeHidden();

      // --- The dashboard updated LIVE, from a real refetch ---------------------
      await expect(passCount).toHaveText("1");
      await expect(failCount).toHaveText("0");
      await expect(blockedCount).toHaveText("0");
      await expect(skippedCount).toHaveText("0");

      const historyItems = page.getByTestId("execution-history-list").getByRole("listitem");
      await expect(historyItems).toHaveCount(1);
      await expect(historyItems.first()).toContainText(fixture.testCaseTitle);
      await expect(historyItems.first()).toContainText("pass");
      await expect(historyItems.first()).toContainText("Behaved as expected.");

      // --- Record #2: the SAME TestCase, a different result --------------------
      // TC-EXEC-003 at the UI layer: this must append, never overwrite.
      await page.getByTestId("record-result-btn").click();
      await expect(page.getByTestId("record-result-modal")).toBeVisible();
      await pickerInput.fill(fixture.testCaseTitle.slice(0, 12));
      const caseOptionAgain = pickerWrapper.getByRole("button", {
        name: fixture.testCaseTitle,
        exact: true,
      });
      await expect(caseOptionAgain).toBeVisible();
      await caseOptionAgain.click();
      await expect(pickerInput).toHaveValue(fixture.testCaseTitle);

      await page.getByTestId("record-result-select").selectOption("fail");
      await page.getByTestId("record-actual-result").fill("Timeout on submit.");
      await page.getByTestId("record-executed-at").fill("2026-09-07T15:30");
      await page.getByTestId("record-result-submit").click();

      await expect(page.getByTestId("record-result-modal")).toBeHidden();

      // Two rows, not one updated row.
      await expect(historyItems).toHaveCount(2);

      // Both dashboard values are live at once — an overwrite would have moved
      // the Pass tile back to 0 rather than adding a Fail alongside it.
      await expect(passCount).toHaveText("1");
      await expect(failCount).toHaveText("1");
      await expect(blockedCount).toHaveText("0");
      await expect(skippedCount).toHaveText("0");

      // Ordered `executed_at` descending (§4): the 15:30 run is first, the
      // 09:00 one second — and the FIRST-recorded row still shows its own
      // original result and notes, which is what "history preserved" means.
      await expect(historyItems.nth(0)).toContainText("fail");
      await expect(historyItems.nth(0)).toContainText("Timeout on submit.");
      await expect(historyItems.nth(1)).toContainText("pass");
      await expect(historyItems.nth(1)).toContainText("Behaved as expected.");

      // --- The database agrees: two distinct rows, not one displayed twice -----
      const stored = runBackendPython<{
        count: number;
        ids: string[];
        results: string[];
        actualResults: (string | null)[];
        executedByActorIds: string[];
      }>(VERIFY_EXECUTIONS_SCRIPT, [fixture.testCycleId, fixture.testCaseId]);

      expect(stored.count).toBe(2);
      expect(new Set(stored.ids).size).toBe(2);
      // Ordered by `executed_at` ascending in the query, so: pass then fail.
      expect(stored.results).toEqual(["pass", "fail"]);
      expect(stored.actualResults).toEqual(["Behaved as expected.", "Timeout on submit."]);
      // `executed_by_actor_id` is stamped server-side from the logged-in user.
      expect(stored.executedByActorIds).toEqual([fixture.userId, fixture.userId]);
    } finally {
      cleanup(fixture, [fixture.testLevelId], [fixture.testTypeId]);
    }
  });
});
