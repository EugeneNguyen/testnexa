import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-2 (ADR-0020, FR-SHELL-2) breadcrumb coverage E2E — TC-SHELL-016,
 * TC-SHELL-017, TC-SHELL-018 and TC-SHELL-019 from
 * `docs/test-cases/2026-09-03-test-cases.md` (the 2026-09-07 correction that
 * added them).
 *
 * **Why a new spec rather than extending `shell-full-template.spec.ts`.** That
 * file is SHELL-2/3/4's *template-shape* spec — dark/light toggle (FR-SHELL-4)
 * and the dashboard stat widgets (FR-SHELL-3), TC-SHELL-010/012/013 — and its
 * fixture is deliberately org-only (User/Org/OrgMembership/RoleAssignment plus
 * two bare Projects), because that is all its own assertions need. The four TCs
 * below need a materially deeper fixture: a Project, a Release, an Environment,
 * a TestPlan, a TestCycle hanging off all three, and a TestCase reachable at a
 * project-scoped admin *edit* route. Folding that into the template spec would
 * make every existing test in it pay the cost of a fixture none of them use,
 * and would put two unrelated FRs in one file. This repo's convention is one
 * spec file per story/concern (`plan2-`, `plan3-`, `exec1-`, ...), so this
 * follows that instead.
 *
 * **What each test asserts, against each TC's literal wording:**
 *
 * **SHELL-9 (ADR-0050, 2026-09-09) rewrote three of the four sections below.**
 * Every project-scoped trail now opens with a resolved `Projects ->
 * {project name}` prefix instead of a bare, unlinked `Project` label, so each
 * of those trails grew by exactly one segment and the old assertions became
 * false. ADR-0050's own Consequences section names this file as one of the two
 * that had to change in the same commit. The `/orgs/:orgId/admin/roles`
 * section (org-scoped) is untouched — no org-scoped trail changed.
 *
 * - TC-SHELL-016 (**revised, SHELL-9**): `/projects/:projectId` renders exactly
 *   TWO crumbs — `Projects`, linked to the resolved org's own list route, then
 *   the project's *real seeded name* as active text. Asserted against the
 *   fixture's actual `projectName` string, not a placeholder, so a resolution
 *   that silently fell back to the old bare label fails here even though *a*
 *   breadcrumb still renders. The TC's original "no Dashboard ancestor" claim
 *   still holds and is still asserted — the new root is `Projects`, not
 *   `Dashboard`.
 * - TC-SHELL-017 (**revised, SHELL-9**): four crumbs now —
 *   `Projects / {project name} / Test Plan / Test Cycle`. The first three are
 *   links, `Test Cycle` is active text, and there is still no `Dashboard`
 *   segment anywhere. The two links the original TC named are asserted by
 *   `href` *and* actually clicked — a link that renders the right `href` but is
 *   not wired for client-side navigation would still pass an href-only
 *   assertion.
 * - TC-SHELL-018 ("Renders 'Dashboard / Roles' ('Roles' sourced from
 *   `pages/admin/registry.ts`'s `allEntities` map, not a hardcoded string);
 *   'Dashboard' links, 'Roles' is active text"): the trail on
 *   `/orgs/:orgId/admin/roles`, plus a second visit to a *different* entity
 *   slug (`test-levels` -> "Test levels") from the same registry, which is what
 *   distinguishes a registry lookup from a hardcoded "Roles" string.
 * - TC-SHELL-019 (**revised, SHELL-9**): four crumbs now —
 *   `Projects / {project name} / Test cases / Edit`; the project's name links
 *   to `/projects/:projectId` (the target the old bare `Project` crumb used to
 *   carry), `Test cases` links to the list route, `Edit` is active text. All
 *   hrefs asserted literally.
 *
 * "Active text" is asserted as CoreUI's own rendered contract for
 * `CBreadcrumbItem active` — `<li class="breadcrumb-item active"
 * aria-current="page">` with no `<a>` inside — not merely "isn't a link".
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack); `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls. Both must be set
 * together — the default below is a prior session's name and will not exist
 * (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-shell-breadcrumb-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface BreadcrumbFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  /**
   * SHELL-9 (ADR-0050): the seeded Project's real `name`. The breadcrumb now
   * renders it as a trail segment, so the assertions need the exact string the
   * seed generated (it carries a random suffix) rather than a literal.
   */
  projectName: string;
  testPlanId: string;
  testCycleId: string;
  testCaseId: string;
  testLevelId: string;
  testTypeId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, one Project/Release/Environment/TestPlan/TestCycle, and one
 * TestCase (with its own TestLevel/TestType) for the admin-edit route.
 *
 * A single active `OrgMembership` is what makes `Login.tsx` land straight on
 * `OrgHome` (`org_context: "auto"`), same convention as
 * `project-create.spec.ts`/`shell-full-template.spec.ts`.
 *
 * `User(name=..., email=..., password_hash=...)` is constructed directly —
 * never `Actor()` then `User(actor_id=...)` (`backend/CLAUDE.md`'s
 * joined-table-inheritance trap) — and the email uses a real-shaped
 * `@example.com` domain, since `POST /auth/login`'s `EmailStr` rejects the
 * IANA reserved TLDs with a 422 that reads exactly like a wrong password.
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.assets import TestCase, TestCaseStatus
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment, TestCycle, TestPlan, TestPlanStatus
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-shell2-bc-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-2 Breadcrumb E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="SHELL-2 Breadcrumb E2E Org", slug=f"shell2-bc-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"SHELL-2 Breadcrumb E2E Project {suffix}")
        session.add(project)
        await session.flush()

        release = Release(project_id=project.id, version_label=f"shell2-bc-rel-{suffix}", target_date=date(2026, 10, 1))
        session.add(release)

        environment = Environment(project_id=project.id, name=f"shell2-bc-env-{suffix}")
        session.add(environment)
        await session.flush()

        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"SHELL-2 Breadcrumb E2E Plan {suffix}",
            scope="Seeded for the SHELL-2 breadcrumb-coverage E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
        await session.flush()

        cycle = TestCycle(
            test_plan_id=plan.id,
            release_id=release.id,
            environment_id=environment.id,
            name=f"SHELL-2 Breadcrumb E2E Cycle {suffix}",
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 8),
        )
        session.add(cycle)

        level = TestLevel(name=f"e2e-shell2-bc-level-{suffix}")
        test_type = TestType(name=f"e2e-shell2-bc-type-{suffix}")
        session.add(level)
        session.add(test_type)
        await session.flush()

        case = TestCase(
            test_condition_id=None,
            test_level_id=level.id,
            test_type_id=test_type.id,
            created_by_actor_id=user.actor_id,
            title=f"SHELL-2 breadcrumb E2E case {suffix}",
            status=TestCaseStatus.draft,
        )
        session.add(case)
        await session.flush()

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "projectId": str(project.id),
            "projectName": project.name,
            "testPlanId": str(plan.id),
            "testCycleId": str(cycle.id),
            "testCaseId": str(case.id),
            "testLevelId": str(level.id),
            "testTypeId": str(test_type.id),
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup taking `(user_id, org_id, project_id,
 * test_level_ids, test_type_ids)` as `sys.argv` — same shape and ordering as
 * `exec1-record-execution.spec.ts`'s, and for the same reason: `TestCycle`'s
 * FKs are `ondelete="RESTRICT"`, so cycles must go before their
 * plans/releases/environments.
 */
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase
from app.models.auth import AuthIdentity, RefreshToken
from app.models.execution import TestExecution
from app.models.planning import EntryExitCriteria, Environment, TestCycle, TestPlan
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
        cycle_ids = []
        if plan_ids:
            cycle_ids = (
                await session.execute(select(TestCycle.id).where(TestCycle.test_plan_id.in_(plan_ids)))
            ).scalars().all()

        if cycle_ids:
            await session.execute(delete(TestExecution).where(TestExecution.test_cycle_id.in_(cycle_ids)))
            await session.execute(delete(TestCycle).where(TestCycle.id.in_(cycle_ids)))

        if plan_ids:
            await session.execute(delete(EntryExitCriteria).where(EntryExitCriteria.test_plan_id.in_(plan_ids)))

        await session.execute(delete(TestCase).where(TestCase.created_by_actor_id == user_id))
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

/**
 * `page.goto` to a protected route, then wait for the shell to actually mount.
 *
 * On a *full page load* (as opposed to a client-side `<Link>` click),
 * `ProtectedRoute` renders only a boot spinner until `AuthContext`'s silent
 * refresh round-trips — `AppShell`, and therefore `AppBreadcrumb`, does not
 * exist in the DOM at all until then. Racing that with a plain 5s assertion
 * fails with "element(s) not found", which reads exactly like a missing
 * breadcrumb-table entry rather than a page that simply hadn't booted yet.
 *
 * Waiting on the breadcrumb `<nav>` to *attach* here, with its own generous
 * timeout, keeps every real assertion in the test body on Playwright's short
 * default — so a genuinely unmapped route still fails fast.
 */
async function gotoProtected(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.goto(path);
  await page
    .getByRole("navigation", { name: "breadcrumb" })
    .waitFor({ state: "attached", timeout: 60_000 });
}

function cleanup(fixture: BreadcrumbFixture): void {
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
      JSON.stringify([fixture.testLevelId]),
      JSON.stringify([fixture.testTypeId]),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("SHELL-2: breadcrumb coverage for the previously unmapped routes", () => {
  /**
   * Playwright's 30s default is a *whole-test* budget, and this test spends a
   * large, browser-independent chunk of it outside the browser: `docker exec -i
   * <backend> python -` cold-starts a fresh interpreter and imports
   * SQLAlchemy + the model tree twice (seed, then cleanup), measured at ~17-28s
   * per invocation on the isolated stack this was written against. On top of
   * that the single test deliberately drives eight navigations, because the four
   * TCs share one fixture and splitting them into four tests would pay that
   * seed/cleanup cost four times over. Neither half fits in 30s; this is an
   * environment-speed allowance, not a flaky-assertion workaround — every
   * `expect` below still runs on its own default 5s timeout.
   */
  test.describe.configure({ timeout: 180_000 });

  test("TC-SHELL-016/017/018/019: every routed screen resolves its own breadcrumb trail", async ({
    page,
  }) => {
    const fixture = runBackendPython<BreadcrumbFixture>(SEED_SCRIPT);
    try {
      // `CBreadcrumb` renders `<nav aria-label="breadcrumb"><ol class="breadcrumb">`
      // and each `CBreadcrumbItem` an `<li class="breadcrumb-item">`; the
      // `active` one additionally carries `.active` + `aria-current="page"`.
      const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
      const crumbs = breadcrumb.getByRole("listitem");
      const activeCrumb = breadcrumb.locator("li.breadcrumb-item.active");

      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      // =======================================================================
      // TC-SHELL-016 — /projects/:projectId
      // REVISED by SHELL-9 (ADR-0050): expected is now the resolved two-crumb
      // trail `Projects / {project name}`, replacing the bare unlinked
      // "Project" this section used to assert. "No Dashboard ancestor" still
      // holds — the new root is `Projects`, not `Dashboard`.
      // =======================================================================
      await gotoProtected(page, `/projects/${fixture.projectId}`);
      await expect(breadcrumb).toBeVisible();
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(0)).toHaveText("Projects");
      // The project's REAL seeded name, not a placeholder — a fallback to the
      // old bare label would fail here even though a breadcrumb still renders.
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);
      // The root crumb links back to the resolved org's own Projects list —
      // the click-path out of a project this whole story exists to add.
      await expect(breadcrumb.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}/projects`,
      );
      // "no Dashboard ancestor", the surviving half of the TC's own title.
      await expect(breadcrumb.getByText("Dashboard")).toHaveCount(0);
      // The old bare label must be gone outright, not merely accompanied.
      await expect(breadcrumb.getByText("Project", { exact: true })).toHaveCount(0);
      // Active text, per the rendered `<li class="breadcrumb-item active">`
      // contract — the name is the current page, so it carries no link.
      await expect(activeCrumb).toHaveText(fixture.projectName);
      await expect(activeCrumb).toHaveAttribute("aria-current", "page");
      await expect(activeCrumb.getByRole("link")).toHaveCount(0);

      // =======================================================================
      // TC-SHELL-017 — /projects/:projectId/test-plans/:testPlanId
      //                /test-cycles/:testCycleId
      // REVISED by SHELL-9 (ADR-0050): four crumbs now —
      // "Projects / {project name} / Test Plan / Test Cycle". The first three
      // are links, "Test Cycle" is active text; still no "Dashboard" segment
      // anywhere in the trail.
      // =======================================================================
      const cyclePath = `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}/test-cycles/${fixture.testCycleId}`;
      await gotoProtected(page, cyclePath);
      await expect(crumbs).toHaveCount(4);
      await expect(crumbs.nth(0)).toHaveText("Projects");
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);
      await expect(crumbs.nth(2)).toHaveText("Test Plan");
      await expect(crumbs.nth(3)).toHaveText("Test Cycle");

      const projectsRootLink = breadcrumb.getByRole("link", { name: "Projects", exact: true });
      const projectLink = breadcrumb.getByRole("link", { name: fixture.projectName, exact: true });
      const planLink = breadcrumb.getByRole("link", { name: "Test Plan", exact: true });
      await expect(projectsRootLink).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}/projects`,
      );
      await expect(projectLink).toHaveAttribute("href", `/projects/${fixture.projectId}`);
      await expect(planLink).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`,
      );
      // "Test Cycle" is active text — no `<a>` inside that crumb at all.
      await expect(crumbs.nth(3).getByRole("link")).toHaveCount(0);
      await expect(activeCrumb).toHaveText("Test Cycle");
      await expect(activeCrumb).toHaveAttribute("aria-current", "page");
      // "no 'Dashboard' segment anywhere in the trail".
      await expect(breadcrumb.getByText("Dashboard")).toHaveCount(0);

      // The TC says the earlier crumbs are links **to their own routes** —
      // assert that by actually following them, not by `href` alone. An `href`
      // that never navigates (or hard-reloads) would still pass above.
      await planLink.click();
      await page.waitForURL(
        new RegExp(`/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}$`),
      );
      await expect(crumbs).toHaveCount(3);
      await expect(crumbs.nth(2)).toHaveText("Test Plan");

      await gotoProtected(page, cyclePath);
      await breadcrumb.getByRole("link", { name: fixture.projectName, exact: true }).click();
      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}$`));
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);

      // =======================================================================
      // TC-SHELL-018 — /orgs/:orgId/admin/roles
      // Expected: "Dashboard / Roles" ("Roles" sourced from the registry's
      // `allEntities` map, not a hardcoded string); "Dashboard" links, "Roles"
      // is active text.
      // =======================================================================
      await gotoProtected(page, `/orgs/${fixture.orgId}/admin/roles`);
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(0)).toHaveText("Dashboard");
      await expect(crumbs.nth(1)).toHaveText("Roles");
      await expect(breadcrumb.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}`,
      );
      await expect(crumbs.nth(1).getByRole("link")).toHaveCount(0);
      await expect(activeCrumb).toHaveText("Roles");
      await expect(activeCrumb).toHaveAttribute("aria-current", "page");

      // "sourced from `registry.ts`'s `allEntities`, not a hardcoded string":
      // a second org-scoped slug from the same registry resolves to its own
      // distinct label. A hardcoded "Roles" could not produce "Test levels".
      await gotoProtected(page, `/orgs/${fixture.orgId}/admin/test-levels`);
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(0)).toHaveText("Dashboard");
      await expect(crumbs.nth(1)).toHaveText("Test levels");

      // =======================================================================
      // TC-SHELL-019 — /projects/:projectId/admin/test-cases/:id/edit
      // REVISED by SHELL-9 (ADR-0050): four crumbs now —
      // "Projects / {project name} / Test cases / Edit". The project's name
      // carries the `/projects/:projectId` link the old bare "Project" crumb
      // used to; "Test cases" links to the list route; "Edit" is active text.
      // =======================================================================
      await gotoProtected(
        page,
        `/projects/${fixture.projectId}/admin/test-cases/${fixture.testCaseId}/edit`,
      );
      await expect(crumbs).toHaveCount(4);
      await expect(crumbs.nth(0)).toHaveText("Projects");
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);
      await expect(crumbs.nth(2)).toHaveText("Test cases");
      await expect(crumbs.nth(3)).toHaveText("Edit");
      await expect(breadcrumb.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}/projects`,
      );
      await expect(
        breadcrumb.getByRole("link", { name: fixture.projectName, exact: true }),
      ).toHaveAttribute("href", `/projects/${fixture.projectId}`);
      await expect(breadcrumb.getByRole("link", { name: "Test cases", exact: true })).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}/admin/test-cases`,
      );
      await expect(crumbs.nth(3).getByRole("link")).toHaveCount(0);
      await expect(activeCrumb).toHaveText("Edit");
      await expect(activeCrumb).toHaveAttribute("aria-current", "page");
    } finally {
      cleanup(fixture);
    }
  });
});
