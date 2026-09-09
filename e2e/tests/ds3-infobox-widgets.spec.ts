import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * DS-3 E2E ([ADR-0043](../../docs/adr/0043-ds-3-infobox-widget-consolidation.md),
 * [DS-3 UI Design Document](../../docs/ui-design/2026-09-08-ds-3-infobox-widget-consolidation-ui-design.md)):
 * real browser, full stack, asserting that both migrated call sites actually
 * render AdminLTE v4's own **Info Box** DOM shape — and that neither retired
 * tile's shape survives.
 *
 * Why this layer and not Vitest: `InfoBox.test.tsx` already proves the
 * *component* renders the right markup when handed the right props. What it
 * cannot prove is that the two real screens actually pass those props and
 * mount the real component — a call site left on the old markup, or an `icon`
 * prop silently dropped, is invisible to a component-level test. Test-design
 * §35's markup-shape class (TC-DS-019) is specifically "asserted against the
 * actual class strings the component renders", which is what a live DOM read
 * gives and a jsdom snapshot of an isolated component does not.
 *
 * Coverage (docs/test-cases/2026-09-03-test-cases.md):
 *   - **TC-DS-019** — `.info-box` root + `.info-box-content` > `.info-box-text`
 *     /`.info-box-number` on all 6 migrated tiles; zero occurrences of
 *     `WidgetStatsTile`'s `card.overflow-hidden` or `StatTile`'s
 *     `card.h-100.text-center` on either screen.
 *   - **TC-DS-021** — icon-supplied (`OrgHome`'s 2 widgets, including
 *     `ActiveMemberCountWidget`'s **new** `fa-solid fa-users`) renders a
 *     populated `.info-box-icon`; icon-omitted (`TestCycleDetail`'s 4 tiles)
 *     renders no `.info-box-icon` element **at all**, not an empty one.
 *   - **TC-DS-020** (corroboration) — every pre-existing `data-testid` still
 *     resolves, and `dashboard-tile-*-count` still lands on the
 *     `.info-box-number` element specifically rather than the root, which is
 *     the exact regression test-design §35 names ("a testid moving to the
 *     wrong DOM node").
 *
 * Seeding/cleanup mirrors `exec1-record-execution.spec.ts`'s established
 * pattern (`docker exec -i ... python -`, FK-safe child-first cleanup) — the
 * full Project/Release/Environment/TestPlan/TestCycle chain is needed because
 * `TestCycleDetail` is the second migrated screen and there is no shortcut to
 * reaching it. Two Projects are seeded so `OrgHome`'s Project-count widget
 * shows a real, non-zero `2` distinct from the member count's `1`.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack); `E2E_BACKEND_CONTAINER` names its
 * backend container. Both must be set together — the default below is a prior
 * session's name and will not exist (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-ds3infobox-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface InfoBoxFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  extraProjectId: string;
  testPlanId: string;
  testCycleId: string;
  testCycleName: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, **two** Projects, and the Release/Environment/TestPlan/
 * TestSuite/TestCase/TestCycle chain `TestCycleDetail` needs.
 *
 * Deliberately **zero** `TestExecution` rows: all four dashboard tiles then
 * render a real server-sourced `0`, which is the value TC-DS-022 requires
 * `OrgHome`-style sentinels never to leak into (no "Loading…", no bare "—" for
 * a genuine zero).
 *
 * `User(name=..., email=..., password_hash=...)` is constructed *directly* —
 * never `Actor()` then `User(actor_id=...)` (`backend/CLAUDE.md`'s
 * joined-table-inheritance trap) — and the matching `AuthIdentity` row is not
 * optional for an account that must actually log in.
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
    email = f"e2e-ds3-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="DS-3 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="DS-3 E2E Org", slug=f"ds3-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        # Exactly two Projects -> the Project-count widget reads "2", the
        # active-member widget reads "1" (this one org_admin, nobody invited).
        project = Project(org_id=org.id, name=f"DS-3 E2E Project {suffix}")
        session.add(project)
        extra_project = Project(org_id=org.id, name=f"DS-3 E2E Extra Project {suffix}")
        session.add(extra_project)
        await session.flush()

        release = Release(project_id=project.id, version_label=f"ds3-rel-{suffix}", target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"ds3-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"DS-3 E2E Plan {suffix}",
            scope="Seeded for the DS-3 InfoBox markup-shape E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle_name = f"DS-3 E2E Cycle {suffix}"
        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=cycle_name,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        suite = TestSuite(project_id=project.id, name=f"ds3-suite-{suffix}")
        session.add(suite)
        await session.flush()
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))

        level = TestLevel(name=f"e2e-ds3-level-{suffix}")
        test_type = TestType(name=f"e2e-ds3-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        case = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"DS-3 covered test case {suffix}",
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
            "extraProjectId": str(extra_project.id),
            "testPlanId": str(plan.id),
            "testCycleId": str(cycle.id),
            "testCycleName": cycle_name,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup taking `(user_id, org_id, project_id,
 * extra_project_id, test_level_ids, test_type_ids)` as `sys.argv`. Same shape
 * and ordering as `exec1-record-execution.spec.ts`'s, including its
 * `TestLog`-before-`TestExecution` step: this spec never records an execution
 * through the UI, but the delete is kept unconditional so the script stays
 * correct if a future case in this file does (EXEC-2/ADR-0036 made
 * `TestLog.test_execution_id` `ON DELETE RESTRICT`).
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution, TestLog
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

user_id, org_id, project_id, extra_project_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
test_level_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []
test_type_ids = json.loads(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else []

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
        await session.execute(delete(Project).where(Project.id.in_([project_id, extra_project_id])))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.commit()

asyncio.run(main())
`;

function seedFixture(): InfoBoxFixture {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as InfoBoxFixture;
}

function cleanup(fixture: InfoBoxFixture): void {
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
      fixture.extraProjectId,
      JSON.stringify([fixture.testLevelId]),
      JSON.stringify([fixture.testTypeId]),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(page: import("@playwright/test").Page, fixture: InfoBoxFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByLabel(/password/i).fill(fixture.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));
}

test.describe("DS-3: shared InfoBox (AdminLTE Info Box) widget consolidation", () => {
  test("TC-DS-019/021: OrgHome's 2 count widgets render Info Box markup with a populated .info-box-icon", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

      // --- ProjectCountWidget: icon supplied (`fa-solid fa-folder`) ----------
      const projectWidget = page.getByTestId("widget-project-count");
      await expect(projectWidget).toBeVisible();

      // TC-DS-019: the root is AdminLTE's `.info-box`, and is NEITHER retired
      // shape. `WidgetStatsTile`'s root was `div.card.overflow-hidden` — both
      // of those classes must be gone from this element, not merely joined by
      // a new one.
      await expect(projectWidget).toHaveClass(/\binfo-box\b/);
      await expect(projectWidget).not.toHaveClass(/\bcard\b/);
      await expect(projectWidget).not.toHaveClass(/\boverflow-hidden\b/);

      // TC-DS-019: the content block, and the two spans inside it, are direct
      // children in AdminLTE's own documented order.
      await expect(projectWidget.locator("> .info-box-content > .info-box-text")).toHaveText("Projects");
      await expect(projectWidget.locator("> .info-box-content > .info-box-number")).toHaveText("2");

      // TC-DS-021 (icon-supplied half): exactly one `.info-box-icon`, really
      // populated with a Font Awesome glyph — not an empty block. The
      // `text-bg-primary` class is the empirically-derived one the demo uses
      // (see InfoBox.tsx's own markup-provenance note), NOT `bg-primary`.
      const projectIcon = projectWidget.locator("> .info-box-icon");
      await expect(projectIcon).toHaveCount(1);
      await expect(projectIcon).toHaveClass(/\btext-bg-primary\b/);
      await expect(projectIcon.locator("i.fa-solid.fa-folder")).toHaveCount(1);

      // The grid column stays caller-owned (UI Design Document §2) — `InfoBox`
      // renders no wrapper of its own, so the widget's parent is OrgHome's
      // pre-existing `col-sm-6`.
      await expect(projectWidget.locator("xpath=..")).toHaveClass(/\bcol-sm-6\b/);

      // --- ActiveMemberCountWidget: the icon that is NEW in this story -------
      const memberWidget = page.getByTestId("widget-active-member-count");
      await expect(memberWidget).toBeVisible();
      await expect(memberWidget).toHaveClass(/\binfo-box\b/);
      await expect(memberWidget).not.toHaveClass(/\bcard\b/);
      await expect(memberWidget).not.toHaveClass(/\boverflow-hidden\b/);
      await expect(memberWidget.locator("> .info-box-content > .info-box-text")).toHaveText(
        "Active org members",
      );
      await expect(memberWidget.locator("> .info-box-content > .info-box-number")).toHaveText("1");

      // ADR-0043's named user-visible change: this widget rendered NO icon
      // block for its entire history and now renders one. Asserting the glyph
      // (not just the block's presence) is what makes this a real regression
      // test rather than a tautology.
      const memberIcon = memberWidget.locator("> .info-box-icon");
      await expect(memberIcon).toHaveCount(1);
      await expect(memberIcon).toHaveClass(/\btext-bg-info\b/);
      await expect(memberIcon.locator("i.fa-solid.fa-users")).toHaveCount(1);

      // TC-DS-019's page-level claim: neither retired shape survives anywhere
      // on this screen, not just on the two migrated elements.
      await expect(page.locator(".card.overflow-hidden")).toHaveCount(0);
      await expect(page.locator(".card.h-100.text-center")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  test("TC-DS-019/021: TestCycleDetail's 4 dashboard tiles render Info Box markup with NO .info-box-icon element", async ({
    page,
  }) => {
    const fixture = seedFixture();
    try {
      await login(page, fixture);

      await page.goto(
        `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}/test-cycles/${fixture.testCycleId}`,
      );
      await expect(page.getByTestId("test-cycle-name")).toHaveText(fixture.testCycleName);
      await expect(page.getByTestId("dashboard-error")).toHaveCount(0);

      const tiles: Array<{ key: string; label: string }> = [
        { key: "pass", label: "Pass" },
        { key: "fail", label: "Fail" },
        { key: "blocked", label: "Blocked" },
        { key: "skipped", label: "Skipped" },
      ];

      for (const { key, label } of tiles) {
        const tile = page.getByTestId(`dashboard-tile-${key}`);
        await expect(tile).toBeVisible();

        // TC-DS-019: `.info-box` root, and NOT `StatTile`'s retired
        // `div.card.h-100.text-center` shape.
        await expect(tile).toHaveClass(/\binfo-box\b/);
        await expect(tile).not.toHaveClass(/\bcard\b/);
        await expect(tile).not.toHaveClass(/\bh-100\b/);
        await expect(tile).not.toHaveClass(/\btext-center\b/);

        await expect(tile.locator("> .info-box-content > .info-box-text")).toHaveText(label);

        // TC-DS-021 (icon-omitted half): the element is absent ENTIRELY, not
        // rendered empty. `toHaveCount(0)` is the assertion that distinguishes
        // those two — a `not.toBeVisible()` would pass for an empty block too.
        await expect(tile.locator(".info-box-icon")).toHaveCount(0);

        // TC-DS-020 / test-design §35's named regression: the count testid must
        // still land on the `.info-box-number` element specifically, not drift
        // up to the `.info-box` root. Selecting by class AND testid together is
        // what proves it is the same logical element as pre-migration.
        const numberEl = tile.locator(`.info-box-number[data-testid="dashboard-tile-${key}-count"]`);
        await expect(numberEl).toHaveCount(1);

        // TC-DS-022: a genuine zero renders as the real server-sourced "0" —
        // never "Loading…" (OrgHome's convention leaking in) and never the "—"
        // sentinel, which is reserved for a not-yet-loaded count.
        await expect(numberEl).toHaveText("0");

        // The column wrapper moved out of the deleted `StatTile` and is now
        // caller-owned, exactly as `OrgHome`'s widgets already were.
        await expect(tile.locator("xpath=..")).toHaveClass(/\bcol-6 col-md-3 mb-3\b/);
      }

      // TC-DS-019's page-level claim, on the second migrated screen.
      await expect(page.locator(".card.h-100.text-center")).toHaveCount(0);
      await expect(page.locator(".card.overflow-hidden")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });
});
