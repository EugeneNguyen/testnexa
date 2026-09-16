import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADR-0074 E2E: relationship tabs on the generic entity detail page — real
 * browser, full stack, real `relations` derived by the real backend from the
 * real `ALL_ENTITY_CONFIGS`.
 *
 * **Why this file exists at all, given the backend unit suite is the heavier
 * half.** `test_adr74_entity_relations.py` proves the derived relationship set
 * is complete and that every served relation *is* listable in principle. It
 * cannot prove the tab actually fetches and renders anything: the frontend's
 * own unit tests run against fixture `relations` and hand-written mocks, so
 * they equally cannot. The specific thing only a live stack can answer is
 * whether the tab's real request — `GET /{entity}?{scopeField}=<id>` against a
 * real gated route with real RBAC and real tenant scoping — returns the rows
 * and renders them. That is this file's whole job.
 *
 * **Entity choice is not arbitrary.** ADR-0074's own Decision §5 turns on
 * `Requirement` being reachable to `TestCase` one way and `TestCondition` two
 * ways, so `requirements` is the only entity that exercises every branch at
 * once — a 1-n child tab, an n-n link tab, and the `" (linked)"` label
 * disambiguation between two tabs with the same target. `test-cases` is the
 * second entity carrying both kinds, and its own derived tab set is asserted
 * too, so the feature is proven against two independent entities rather than
 * one.
 *
 * **ADR-0075 Amendment 1 (2026-09-15): junctions are tabbed from BOTH ends.**
 * ADR-0075 registered the six n-n junction tables but left each one's
 * `scope_field` a single column, so `derive_entity_relations` emitted a
 * relation for the scope side only — `TestSuite` got "Test cases (linked)"
 * while `TestCase` got nothing for the identical, genuinely bidirectional
 * relationship, and `Defect`'s detail page rendered no tab strip at all.
 * Amendment 1 widens all six to the branching 2-tuple naming both FK columns,
 * so each junction now emits one relation per direction. Every exact tab-list
 * assertion below is therefore a *positional* assertion against the post-
 * Amendment derivation: `test-cases` went from three tabs to six, `test-suites`
 * from one to two, and the previously-asserted absence of those reverse tabs
 * (ADR-0075 Decision §3, superseded) is gone. Not one line of the derivation
 * changed to get this — the widened `scope_field` alone does it — which is why
 * the live proof that the reverse tab actually *fetches and renders* is worth
 * its own test rather than being inferred from the forward one.
 *
 * **[ADR-0078](../../docs/adr/0078-compound-create-through-bespoke-routes.md)
 * (2026-09-16): `test-cases` gains a seventh tab, by the same mechanism a third
 * time.** That ADR widens `TestExecution.scope_field` to
 * `("test_cycle_id", "test_case_id")` so a `TestCase`'s "Defects (linked)" tab
 * can scope its execution picker to the record being viewed — and the
 * derivation emits the new arm as a one-to-many "Test executions" tab with no
 * further change. The positional assertion below is what caught it: a new tab
 * on a screen that story was not otherwise about.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER` names its
 * backend container. Seed/cleanup follows `admin6-entity-detail-page.spec.ts`
 * verbatim, including the FK-safe child-first delete order and the
 * `refresh_token` row the login itself mints.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-deve77ffc-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

/**
 * Each test here pays `seedFixture()` — a `docker exec ... python -` that
 * imports the whole FastAPI app in a fresh interpreter inside the backend
 * container — inside its own timed body, before the browser does anything.
 * On a contended host that single import was measured between 17s and 98s
 * (2026-09-15: ten sibling isolated stacks plus unrelated containers on the
 * same Docker VM, `docker stats` showing one at 127% CPU), so the `90000` this
 * file shipped with was structurally too small there — every run died on
 * `page.goto("/login")` with the fixture having already eaten the budget,
 * reading exactly like a broken login flow. The app itself was fine
 * throughout: a warm raw navigation to the same URL returned in ~1s.
 *
 * `e2e/CLAUDE.md`'s own note on this ("each story adds one more round trip on
 * top of the one before it... don't just keep copy-pasting the previous
 * story's spec shape and assume its untouched defaults still have headroom")
 * is the same reasoning; here the round trips are the fixture's, not the
 * browser's. A generous ceiling costs nothing on an idle host — a passing test
 * returns as fast as it ever did — and is the difference between a real result
 * and an environmental false negative on a busy one.
 */
const PER_TEST_TIMEOUT_MS = 300000;

/**
 * `gotoDetail` below waits on the record's own `GET /{resource}/{id}` — but
 * the tab strip is driven by a *separate* `GET /entities/{resource}/schema`
 * request, and on a `test-cases` detail page four more ref-entity schema
 * fetches ride alongside it. Measured live on the contended host described
 * above: the schema responses landed ~9s after the navigation began, the
 * record fetch ~10s. The 5s default is simply under that, so every assertion
 * that is the first read of a freshly-loaded tab strip carries this
 * explicitly, per `e2e/CLAUDE.md`'s own prescription for the same class of
 * race.
 */
const TAB_STRIP_TIMEOUT_MS = 20000;

interface SeededFixture {
  orgAdmin: { email: string; password: string; userId: string };
  orgId: string;
  projectId: string;
  requirementId: string;
  requirementTitle: string;
  /** Child of the Requirement via `TestCondition.requirement_id` — the 1-n tab. */
  testConditionId: string;
  testConditionDescription: string;
  /** Linked to the Requirement via `RequirementTestCaseLink` — the n-n tab. */
  testCaseId: string;
  testCaseTitle: string;
  /** Child of the TestCase via `TestStep.test_case_id` — a 1-n tab on a second entity. */
  testStepId: string;
  testStepAction: string;
  /** `TestCase` requires both catalogs; seeded and cleaned up with the rest. */
  testLevelId: string;
  testTypeId: string;
  /**
   * ADR-0075. Linked to the TestCase via `TestSuiteTestCase` — the junction
   * that had no `CrudEntityConfig`, so `TestSuite` derived *zero* tabs.
   */
  testSuiteId: string;
  testSuiteName: string;
  /** Includes the TestSuite via `TestPlanTestSuite` — the second such junction. */
  testPlanId: string;
  testPlanIdentifier: string;
}

/**
 * One Organization/Project + an org_admin, a Requirement carrying **both**
 * relationship kinds (a `TestCondition` child, and a `TestCase` reached through
 * `RequirementTestCaseLink`), and a `TestStep` child of that TestCase so a
 * second entity's 1-n tab has a real row too.
 *
 * The many-to-many row-click case deliberately uses the Requirement -> TestCase
 * link rather than the TestCase -> Defect one: both exercise the identical
 * `targetField` code path, and this one needs no `TestPlan` -> `TestCycle` ->
 * `TestExecution` -> `Defect` chain (every link of which carries its own
 * required FKs) to stand up. `test-cases`' own "Defects (linked)" tab is still
 * asserted to *exist* — tabs are derived from the schema, so that assertion
 * needs no Defect row behind it.
 *
 * The same reasoning now covers `test-cases`' three **reverse-direction** tabs,
 * which ADR-0075 Amendment 1 added: "Requirements (linked)", "Test conditions
 * (linked)" and "Test suites (linked)" are all derived from the widened
 * `scope_field`, so all three are asserted to exist off this one fixture. Only
 * one of them is also driven end to end with a real row behind it — the
 * `TestSuiteTestCase` seeded below doubles as the `test-cases` -> `test-suites`
 * fixture, so the reverse arm's real scoped request (`GET
 * /test-suite-test-cases?test_case_id=`) and its rendered row are proven live,
 * not inferred from the forward arm passing. The other two reverse arms go
 * through the identical branching-resolver code path and are covered at the
 * backend layer (`test_adr75_amendment1_bidirectional_junctions.py`, both the
 * unit and integration halves).
 *
 * `TestCase.test_level_id`/`test_type_id` are NOT NULL, so a TestLevel and a
 * TestType are seeded alongside (checked against the real model columns, not
 * assumed).
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import (
    Requirement, TestCase, TestCondition, TestConditionPriority, TestStep, TestSuite, TestSuiteTestCase,
)
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import TestPlan, TestPlanTestSuite
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.models.trace import RequirementTestCaseLink

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    async with AsyncSessionLocal() as session:
        email = f"e2e-admin7-org-admin-{suffix}@example.com"
        org_admin = User(name="ADMIN-7 E2E org admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(org_admin)
        await session.flush()
        session.add(AuthIdentity(user_id=org_admin.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-7 E2E Org", slug=f"admin7-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=org_admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=org_admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"ADMIN-7 E2E Project {suffix}")
        session.add(project)
        await session.flush()

        level = TestLevel(name=f"ADMIN-7 Level {suffix}")
        test_type = TestType(name=f"ADMIN-7 Type {suffix}")
        session.add_all([level, test_type])
        await session.flush()

        requirement_title = f"ADMIN-7 Requirement {suffix}"
        requirement = Requirement(
            project_id=project.id,
            title=requirement_title,
            description=f"ADMIN-7 requirement description {suffix}",
            external_ref=f"ADMIN7-{suffix}",
        )
        session.add(requirement)
        await session.flush()

        # 1-n child of the Requirement.
        condition_description = f"ADMIN-7 Condition {suffix}"
        condition = TestCondition(
            requirement_id=requirement.id,
            description=condition_description,
            priority=TestConditionPriority.medium,
        )
        session.add(condition)
        await session.flush()

        # n-n partner of the Requirement, and itself a 1-n parent of TestStep.
        test_case_title = f"ADMIN-7 TestCase {suffix}"
        test_case = TestCase(
            project_id=project.id,
            title=test_case_title,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=org_admin.actor_id,
        )
        session.add(test_case)
        await session.flush()
        session.add(RequirementTestCaseLink(requirement_id=requirement.id, test_case_id=test_case.id))

        # 1-n child of the TestCase.
        step_action = f"ADMIN-7 Step action {suffix}"
        step = TestStep(test_case_id=test_case.id, sequence=1, action=step_action, expected_result="ok")
        session.add(step)
        await session.flush()

        # ADR-0075: the two junction tables that had no CrudEntityConfig. Rows
        # are inserted directly here rather than through REQ-4's/PLAN-1's
        # bespoke routes on purpose -- this spec's subject is what the detail
        # page renders, and the backend integration suite
        # (test_adr75_junction_relations.py) already covers the real-write-path
        # round trip. A direct insert keeps the fixture one transaction.
        suite_name = f"ADMIN-7 Suite {suffix}"
        suite = TestSuite(project_id=project.id, name=suite_name, purpose="ADR-0075 relation tab fixture")
        session.add(suite)
        await session.flush()
        session.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=test_case.id))

        plan_identifier = f"ADMIN-7 Plan {suffix}"
        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=org_admin.actor_id,
            identifier=plan_identifier,
        )
        session.add(plan)
        await session.flush()
        session.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))
        await session.flush()

        await session.commit()
        print(json.dumps({
            "orgAdmin": {"email": email, "password": PASSWORD, "userId": str(org_admin.actor_id)},
            "orgId": str(org.id),
            "projectId": str(project.id),
            "requirementId": str(requirement.id),
            "requirementTitle": requirement_title,
            "testConditionId": str(condition.id),
            "testConditionDescription": condition_description,
            "testCaseId": str(test_case.id),
            "testCaseTitle": test_case_title,
            "testStepId": str(step.id),
            "testStepAction": step_action,
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
            "testSuiteId": str(suite.id),
            "testSuiteName": suite_name,
            "testPlanId": str(plan.id),
            "testPlanIdentifier": plan_identifier,
        }))

asyncio.run(main())
`;

/** FK-safe delete order (child-first), link tables before the rows they link. */
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestCondition, TestStep, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import TestPlan, TestPlanTestSuite
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership
from app.models.trace import RequirementTestCaseLink

(org_admin_id, org_id, project_id, requirement_id, condition_id, test_case_id,
 step_id, level_id, type_id, suite_id, plan_id) = sys.argv[1:12]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RequirementTestCaseLink).where(RequirementTestCaseLink.requirement_id == requirement_id))
        # ADR-0075's two junctions, before the rows on either side of them.
        await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id == plan_id))
        await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id == suite_id))
        await session.execute(delete(TestPlan).where(TestPlan.id == plan_id))
        await session.execute(delete(TestSuite).where(TestSuite.id == suite_id))
        await session.execute(delete(TestStep).where(TestStep.id == step_id))
        await session.execute(delete(TestCase).where(TestCase.id == test_case_id))
        await session.execute(delete(TestCondition).where(TestCondition.id == condition_id))
        await session.execute(delete(Requirement).where(Requirement.id == requirement_id))
        await session.execute(delete(TestLevel).where(TestLevel.id == level_id))
        await session.execute(delete(TestType).where(TestType.id == type_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == org_admin_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == org_admin_id))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == org_admin_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == org_admin_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == org_admin_id))
        await session.execute(delete(Actor).where(Actor.id == org_admin_id))
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
      fixture.orgAdmin.userId,
      fixture.orgId,
      fixture.projectId,
      fixture.requirementId,
      fixture.testConditionId,
      fixture.testCaseId,
      fixture.testStepId,
      fixture.testLevelId,
      fixture.testTypeId,
      fixture.testSuiteId,
      fixture.testPlanId,
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(page: import("@playwright/test").Page, email: string, password: string, orgId: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  // Login lands on `/dashboard`, which resolves `getMyOrgs()` over the network
  // and only then replaces the history entry with `/orgs/{id}` — so this waits
  // on two client-side hops plus a real round trip, not just a form submit.
  // Measured past 20s on the contended host described above, with `/dashboard`
  // reached and the org fetch still outstanding.
  await page.waitForURL(new RegExp(`/orgs/${orgId}`), { timeout: 60000 });
}

/**
 * Open a detail page and wait for its own record fetch before asserting.
 *
 * The trailing container assertion earns its place: a tab-strip assertion made
 * against the *wrong page* fails as `Received: Array []` — indistinguishable,
 * from the failure output alone, from a derivation that genuinely stopped
 * emitting relations. Hit live 2026-09-15 (an edit that dropped one of these
 * calls entirely cost several full-suite runs before the page snapshot, not
 * the assertion message, gave it away). Asserting the page is actually on
 * screen fails at the navigation instead, where the cause is obvious.
 */
async function gotoDetail(
  page: import("@playwright/test").Page,
  url: string,
  resourcePath: string,
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/v1/${resourcePath}/`) && res.request().method() === "GET",
    ),
    page.goto(url),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId("entity-detail-page")).toBeVisible({
    timeout: TAB_STRIP_TIMEOUT_MS,
  });
}

test.describe("ADR-0074: entity detail relationship tabs", () => {
  // Same reasoning as `admin6-entity-detail-page.spec.ts`: each test drives
  // several full page loads against the dev-profile Vite server, and running
  // them concurrently starves it. Scoped to this file only.
  test.describe.configure({ mode: "serial" });

  /**
   * TC-ADMIN-065 / TC-ADMIN-066 / TC-ADMIN-072, against the real derivation.
   *
   * `requirements` is the entity where every branch coincides: an Info tab, two
   * 1-n child tabs, two n-n link tabs, and — the case ADR-0074 Decision §5
   * exists for — two of those tabs targeting `test-conditions`, distinguished
   * only by the `" (linked)"` suffix. A backend unit test asserts the derived
   * labels; this asserts the browser actually renders them as distinct,
   * selectable tabs.
   */
  test("TC-ADMIN-065/066/072: a Requirement's detail page shows Info plus its real 1-n and n-n tabs, with linked tabs disambiguated", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      // Info is first and selected on arrival, with ADR-0073's field list under it.
      const tabs = page.getByRole("tab");
      await expect(tabs.first()).toHaveText("Info", { timeout: TAB_STRIP_TIMEOUT_MS });
      await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();

      // The real derived tab set for `requirements`, in the derivation's own
      // deterministic order (children first, then links, each alphabetical).
      await expect(tabs).toHaveText(
        [
          "Info",
          "Risk items",
          "Test conditions",
          "Test cases (linked)",
          "Test conditions (linked)",
        ],
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );

      // TC-ADMIN-066's exclusion half: `Requirement.project_id` is a
      // many-to-one pointing at its parent Project. It renders as a field...
      await expect(page.getByTestId("entity-detail-field-project_id")).toBeVisible();
      // ...and must not have become a tab.
      await expect(page.getByTestId("entity-detail-tab-projects")).toHaveCount(0);

      /**
       * ADR-0074's Amendment — Tabler's documented "tabs in the card header"
       * markup, asserted in a real browser because this is the half the unit
       * tests structurally cannot answer: jsdom applies no CSS, so only a real
       * engine can confirm the classes actually *resolve* (`.tab-content >
       * .tab-pane` is `display:none` without `.active`, and a strip whose
       * `card-header-tabs` were dropped would still pass every DOM assertion
       * while rendering as a detached row of tabs above the card).
       */
      const detailPage = page.getByTestId("entity-detail-page");
      const tablist = page.getByTestId("entity-detail-tablist");
      await expect(tablist).toHaveClass(/\bcard-header-tabs\b/);
      // The strip is inside the card's own header...
      await expect(detailPage.locator(".card > .card-header > .nav-tabs.card-header-tabs")).toHaveCount(1);
      // ...and the panel is an active pane in that same card's body.
      const panel = page.getByRole("tabpanel");
      await expect(panel).toHaveClass(/\btab-pane\b.*\bactive\b/);
      await expect(detailPage.locator(".card > .card-body.tab-content > .tab-pane.active")).toHaveCount(1);
      // Really painted, not merely present — the `display:none` trap above.
      await expect(panel).toBeVisible();
      // The nav sits above the panel, and both are in the one card.
      const navBox = (await tablist.boundingBox())!;
      const panelBox = (await panel.boundingBox())!;
      expect(navBox.y + navBox.height).toBeLessThanOrEqual(panelBox.y + 1);

      // The heading and Back action live above the card (Tabler's
      // `.card-header-tabs` is `flex:1` with negative margins on all four
      // sides, so it consumes the header) — and stay put on every tab.
      await expect(detailPage.locator(".card").getByTestId("entity-detail-back")).toHaveCount(0);
      await expect(page.getByTestId("entity-detail-back")).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-067 / TC-ADMIN-069: opening a 1-n tab really fetches and renders
   * the child rows scoped to this record, the scoping column is suppressed, and
   * the tab is reflected in the URL.
   *
   * The scoped-request assertion is made on the **real network request**, not
   * inferred from the rendered rows — a tab rendering the right rows by
   * coincidence (an unscoped list that happens to contain them) would look
   * identical on screen.
   */
  test("TC-ADMIN-067/069: a one-to-many tab lists the real child rows scoped to this record and appears in the URL", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      const [listResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/v1/test-conditions?") && res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-test-conditions").click(),
      ]);

      expect(listResponse.ok()).toBeTruthy();
      // Scoped to this Requirement, via the relation's own scopeField.
      expect(new URL(listResponse.url()).searchParams.get("requirement_id")).toBe(fixture.requirementId);

      // The real child row renders.
      await expect(page.getByText(fixture.testConditionDescription)).toBeVisible({ timeout: 15000 });

      // The scoping column is suppressed — same value on every row here.
      const headers = await page.getByRole("columnheader").allTextContents();
      expect(headers).toContain("Description");
      expect(headers).not.toContain("Requirement");

      /**
       * ADR-0074's Amendment: the related table renders inside the page's one
       * card (`EntityTable` in `bare` mode), not as a second card nested in
       * that card's body — the visible defect the relocation would otherwise
       * introduce, and one no unit test can see, since a nested `.card`'s
       * border and shadow are purely CSS.
       */
      const detailPage = page.getByTestId("entity-detail-page");
      await expect(detailPage.locator(".card")).toHaveCount(1);
      await expect(detailPage.locator(".card-header")).toHaveCount(1);
      await expect(page.getByRole("tabpanel").getByRole("table")).toHaveCount(1);
      // Back survives the tab switch — under the pre-Amendment markup the
      // whole header lived in the Info panel and vanished with it.
      await expect(page.getByTestId("entity-detail-back")).toBeVisible();
      await expect(detailPage.getByRole("heading", { name: /details$/i })).toBeVisible();

      // TC-ADMIN-069: the active tab is in the URL, so this view is shareable.
      await expect(page).toHaveURL(/\?tab=test-conditions/);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-068: the many-to-many case, and the one that cannot be inferred
   * from the one-to-many case — the rows listed are
   * `requirement-test-case-links`, but a row click must follow `targetField`
   * to the **TestCase**, not open the link row. Asserted as an exact URL, plus
   * an explicit check that the listed row's id is NOT the TestCase's, so
   * "navigated somewhere" cannot pass and neither can a coincidence.
   */
  test("TC-ADMIN-068: a many-to-many tab lists link rows but a row click opens the far entity's detail page", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // First, the tab set of the *other* both-kinds entity. Tabs are derived
      // from the schema, not from data, so this needs no Defect row behind it.
      //
      // ADR-0075 Amendment 1: this was `["Info", "Attachments", "Test steps",
      // "Defects (linked)"]` while all six junctions scoped from one end only.
      // `TestCase` is the entity three separate junctions point at, and it
      // could show none of them; widening every `scope_field` to the branching
      // 2-tuple emits the reverse arm of each, so three more `" (linked)"` tabs
      // appear. Still an exact, positional list — children alphabetical first,
      // then links alphabetical (`derive_entity_relations`' own sort key).
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}`,
        "test-cases",
      );
      await expect(page.getByRole("tab")).toHaveText(
        [
          "Info",
          "Attachments",
          // ADR-0078: `TestExecution`'s `scope_field` widened to the branching
          // pair `("test_cycle_id", "test_case_id")` — needed so the
          // "Defects (linked)" tab can scope its execution picker to this very
          // test case — and `derive_entity_relations` emits the new arm as a
          // one-to-many tab for free. A test case's own execution history,
          // which nothing else in the app lists.
          "Test executions",
          "Test steps",
          "Defects (linked)",
          "Requirements (linked)",
          "Test conditions (linked)",
          "Test suites (linked)",
        ],
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );

      // Now the row-click case, on the Requirement -> TestCase link (same
      // `targetField` code path, no TestExecution/Defect chain to seed).
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/requirements/${fixture.requirementId}`,
        "requirements",
      );

      const [listResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/requirement-test-case-links?") &&
            res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-requirement-test-case-links").click(),
      ]);
      expect(listResponse.ok()).toBeTruthy();
      expect(new URL(listResponse.url()).searchParams.get("requirement_id")).toBe(
        fixture.requirementId,
      );

      // What is LISTED is the link row, carrying the link's own id...
      const linkRow = page.getByTestId(/^entity-table-row-/).first();
      await expect(linkRow).toBeVisible({ timeout: 15000 });
      const linkRowTestId = await linkRow.getAttribute("data-testid");
      expect(linkRowTestId).not.toBe(`entity-table-row-${fixture.testCaseId}`);

      await linkRow.click();

      // ...but the click lands on the TEST CASE, following `targetField` —
      // an exact URL, so "navigated somewhere" cannot pass, and specifically
      // not the link row's own detail page.
      await expect(page).toHaveURL(
        new RegExp(`/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}$`),
      );
      await expect(page.getByTestId("entity-detail-field-title")).toContainText(
        fixture.testCaseTitle,
      );
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-069 (deep-link half): arriving with `?tab=` opens that tab
   * directly against the real backend, without an Info-tab render first — the
   * claim that makes a relationship tab genuinely shareable.
   */
  test("TC-ADMIN-069: a ?tab= deep link opens that relationship tab directly on load", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      await page.goto(
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}?tab=test-steps`,
      );

      await expect(page.getByText(fixture.testStepAction)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("entity-detail-tab-test-steps")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The Info panel is not also rendered.
      await expect(page.getByTestId("entity-detail-fields")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-065 (negative half), against a real entity rather than a fixture:
   * an entity the real derivation reports no relationships for renders no tab
   * strip at all. `test-steps` is such an entity — nothing in the registry
   * declares an FK to it.
   */
  test("TC-ADMIN-065: an entity with no derived relationships renders no tab strip", async ({ page }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-steps/${fixture.testStepId}`,
        "test-steps",
      );

      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();
      await expect(page.getByTestId("entity-detail-tablist")).toHaveCount(0);
      await expect(page.getByRole("tab")).toHaveCount(0);

      // ADR-0074's Amendment: with no strip there is no header to give it, so
      // the card carries none — and no `tab-content`/`tab-pane`/`tabpanel`
      // either, which would be a tabpanel with no tablist.
      const detailPage = page.getByTestId("entity-detail-page");
      await expect(detailPage.locator(".card-header")).toHaveCount(0);
      await expect(detailPage.locator(".tab-content")).toHaveCount(0);
      await expect(detailPage.locator(".tab-pane")).toHaveCount(0);
      await expect(page.getByRole("tabpanel")).toHaveCount(0);
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * TC-ADMIN-075 — ADR-0075, the gap ADR-0074's own completeness test could not
   * see.
   *
   * `TestSuite` is the sharpest case in the whole feature, and the reason it is
   * worth a live assertion rather than only a backend one: before ADR-0075 this
   * page rendered **no tab strip at all** — `getByRole("tab")` returned 0, the
   * card had no header, and the page was indistinguishable from `TestStep`'s
   * genuinely-relationless one asserted directly above. Nothing was broken;
   * `test_suite_test_case` simply had no `CrudEntityConfig`, so the derivation
   * had nothing to walk. A relationship that renders nothing and a relationship
   * that does not exist look identical from the browser, which is exactly why
   * the model-layer guard (`test_adr75_registry_completeness.py`) had to be
   * added alongside the fix.
   *
   * Asserts the full chain a user experiences: the strip now exists, its tab
   * fires the real scoped list request, real rows render, and a row click
   * follows `targetField` through to the far `TestCase` — plus `TestPlan`,
   * whose gap was the more dangerous shape (a tab strip that already looked
   * complete with three tabs, silently missing a fourth).
   *
   * **ADR-0075 Amendment 1 moved one of the two lists asserted here.**
   * `test-suites` was `["Info", "Test cases (linked)"]` under Decision §3's
   * single-column `scope_field`; widening `test_plan_test_suite` to the
   * branching 2-tuple emits its reverse arm too, so `TestSuite` also gains
   * "Test plans (linked)". `test-plans` is unchanged — it was already the
   * junction's scope side, which is exactly the asymmetry the amendment
   * removes. The forward direction proven below is now half the story; the
   * reverse direction from `TestCase`'s own page gets its own test, since a
   * derived tab existing and a derived tab actually serving rows are separate
   * claims (the branching resolver is the half that can 404 a perfectly
   * well-derived tab).
   */
  test("TC-ADMIN-075: the junction tables registered by ADR-0075 render real relationship tabs", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);

      // --- TestSuite: an empty strip before ADR-0075, two tabs after --------
      // Amendment 1 adds the second: `test_plan_test_suite`'s reverse arm.
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-suites/${fixture.testSuiteId}`,
        "test-suites",
      );
      await expect(page.getByRole("tab")).toHaveText(
        ["Info", "Test cases (linked)", "Test plans (linked)"],
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );
      // The strip is a real card header, same Amendment-1 markup every other
      // tabbed detail page uses — not a special case bolted on.
      await expect(page.getByTestId("entity-detail-tablist")).toHaveClass(/\bcard-header-tabs\b/);

      const [suiteListResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/test-suite-test-cases?") && res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-test-suite-test-cases").click(),
      ]);
      expect(suiteListResponse.ok()).toBeTruthy();
      // The scoped request is the one the relation describes — a plain
      // unscoped `GET /test-suite-test-cases` is a 422 by design (NFR-74).
      expect(new URL(suiteListResponse.url()).searchParams.get("test_suite_id")).toBe(
        fixture.testSuiteId,
      );

      // A real row, not an empty table: the far TestCase's title resolves
      // through `EntityTable`'s own fk-label lookup, which is only possible
      // because `test_case_id` carries a `ref_entity` in the new config.
      const suitePanel = page.getByRole("tabpanel");
      await expect(suitePanel.getByText(fixture.testCaseTitle)).toBeVisible({ timeout: 15000 });
      // ADR-0074 Decision §6: the scoping column is suppressed, so the suite's
      // own id — identical on every row here by construction — is not a column.
      await expect(suitePanel.getByText(fixture.testSuiteId)).toHaveCount(0);

      // ADR-0074 Decision §5: the listed row is a link row, but the click
      // follows `targetField` to the far record's own detail page.
      await suitePanel.getByText(fixture.testCaseTitle).click();
      await page.waitForURL(
        `**/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}`,
      );
      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();

      // --- TestPlan: a fourth tab appended to three that already worked ------
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-plans/${fixture.testPlanId}`,
        "test-plans",
      );
      await expect(page.getByRole("tab")).toHaveText(
        ["Info", "Entry/exit criteria", "Risk items", "Test cycles", "Test suites (linked)"],
        { timeout: TAB_STRIP_TIMEOUT_MS },
      );

      const [planListResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/test-plan-test-suites?") && res.request().method() === "GET",
        ),
        page.getByTestId("entity-detail-tab-test-plan-test-suites").click(),
      ]);
      expect(planListResponse.ok()).toBeTruthy();
      expect(new URL(planListResponse.url()).searchParams.get("test_plan_id")).toBe(
        fixture.testPlanId,
      );
      await expect(page.getByRole("tabpanel").getByText(fixture.testSuiteName)).toBeVisible({
        timeout: 15000,
      });
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * ADR-0075 **Amendment 1** — the reverse direction, end to end, in a real
   * browser. This is the case that started the amendment: `GET
   * /entities/test-cases/schema` carried no `test_suite` relation at all, so a
   * TestCase's detail page could not show the suites it belongs to even though
   * the join rows were right there.
   *
   * **Why this needs its own live test rather than following from the test
   * above.** The forward direction (`TestSuite` -> its TestCases) already
   * passed before the amendment, and the amendment changed *no line* of
   * `derive_entity_relations` — widening `scope_field` to the branching
   * 2-tuple emits the reverse relation for free. What it does NOT get for free
   * is the **resolver**: `crud_factory._resolve_scope_for_write` hands
   * `resolve_org_id` a `types.SimpleNamespace` carrying only the one arm the
   * caller actually supplied, so a config widened to two arms but left with a
   * single-arm walk derives a perfectly good relation, renders a perfectly
   * good tab, and then 404s every request that tab fires. A tab-strip
   * assertion alone cannot tell those two states apart — only firing the real
   * request and reading real rows out of the response can, which is exactly
   * the division of labour this file's own header docstring claims as its job.
   *
   * The backend layer proves the same round trip without a browser
   * (`test_adr75_amendment1_bidirectional_junctions.py`, unit + integration);
   * neither substitutes for the other, per that file's own note.
   */
  test("ADR-0075 Amendment 1: a TestCase's reverse-direction 'Test suites (linked)' tab fetches and lists its real link rows", async ({
    page,
  }) => {
    test.setTimeout(PER_TEST_TIMEOUT_MS);
    const fixture = seedFixture();
    try {
      await login(page, fixture.orgAdmin.email, fixture.orgAdmin.password, fixture.orgId);
      await gotoDetail(
        page,
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}`,
        "test-cases",
      );

      // The tab exists at all — the half that was missing entirely before the
      // amendment, and the same junction entity the TestSuite page tabs to
      // from its other end.
      const suitesTab = page.getByTestId("entity-detail-tab-test-suite-test-cases");
      await expect(suitesTab).toBeVisible({ timeout: TAB_STRIP_TIMEOUT_MS });
      await expect(suitesTab).toHaveText("Test suites (linked)");

      // Clicking it fires the REVERSE arm's scoped list request. Asserted on
      // the real network request, not inferred from what rendered: an unscoped
      // `GET /test-suite-test-cases` is a 422 by design (NFR-74), and a
      // single-arm resolver would 404 this exact call while the tab above
      // still looked perfectly correct.
      const [reverseListResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/test-suite-test-cases?") && res.request().method() === "GET",
        ),
        suitesTab.click(),
      ]);
      expect(reverseListResponse.ok()).toBeTruthy();
      expect(new URL(reverseListResponse.url()).searchParams.get("test_case_id")).toBe(
        fixture.testCaseId,
      );
      // Scoped by the new arm, and *only* by it — not the pre-amendment one.
      expect(new URL(reverseListResponse.url()).searchParams.get("test_suite_id")).toBeNull();

      // The seeded `TestSuiteTestCase` really lists, with the far TestSuite's
      // name resolved through `EntityTable`'s fk-label lookup — possible only
      // because `test_suite_id` carries its own `ref_entity`/`label_field`.
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByText(fixture.testSuiteName)).toBeVisible({ timeout: 15000 });

      // ADR-0074 Decision §6, now applying to the reverse arm: the scoping
      // column is what gets suppressed, so it is `Test case` that is absent
      // here and `Test suite` that remains — the mirror image of the forward
      // tab asserted above, which is what proves the suppression follows the
      // relation's own `scopeField` rather than a hardcoded side.
      const headers = await page.getByRole("columnheader").allTextContents();
      expect(headers).toContain("Test suite");
      expect(headers).not.toContain("Test case");

      // TC-ADMIN-069's URL half holds for a reverse tab too.
      await expect(page).toHaveURL(/\?tab=test-suite-test-cases/);

      // And the row click follows `targetField` the other way — to the far
      // TestSuite, not to the link row's own detail page.
      await panel.getByText(fixture.testSuiteName).click();
      await page.waitForURL(
        `**/projects/${fixture.projectId}/admin/test-suites/${fixture.testSuiteId}`,
      );
      await expect(page.getByTestId("entity-detail-fields")).toBeVisible();
    } finally {
      cleanup(fixture);
    }
  });
});
