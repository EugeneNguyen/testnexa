import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * SHELL-9 (ADR-0050) project-scope nav context E2E — TC-SHELL-029,
 * TC-SHELL-031 and TC-SHELL-032 from `docs/test-cases/2026-09-03-test-cases.md`.
 *
 * **What this story fixed, and therefore what must be proven in a real
 * browser.** `AppSidebar`/`AppBreadcrumb` derived all org-scoped nav content
 * from a raw `useParams<{orgId}>()` read. No route under
 * `/projects/:projectId/...` carries that param, so on every project-scoped
 * screen both `navItems` and `navGroups` computed to empty arrays: the sidebar
 * rendered brand-only and the breadcrumb rendered a bare, unlinked "Project"
 * label. Opening a project was a dead end — the browser back button or a
 * hand-edited URL were the only ways out. Both components now read
 * `useResolvedOrgId()`, which fetches the Project row and reads its `org_id`.
 *
 * **Division of labour against the Vitest layer** (`frontend/tests/`), so
 * neither duplicates the other pointlessly:
 *
 * - TC-SHELL-030 (the same resolution on all four *other* project-scoped route
 *   shapes) and TC-SHELL-033 (pending / 404 graceful degradation) are asserted
 *   in Vitest, where a fetch can be held pending or made to reject
 *   deterministically. Neither is reliably forceable through a real stack.
 * - TC-SHELL-034 (exactly one `GET /projects/{id}` across all consumers) is
 *   asserted in Vitest by counting real requests leaving `apiFetch`.
 * - The three TCs *here* are the ones whose whole point is a real browser: a
 *   real full page load direct onto a project route (TC-SHELL-029), a real
 *   click that really navigates (TC-SHELL-031), and a real rendered trail
 *   against a real seeded name (TC-SHELL-032).
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL` points
 * at (never the main `testnexa` stack); `E2E_BACKEND_CONTAINER` names its
 * backend container for the seed/cleanup `docker exec` calls. Both must be set
 * together — the default below names this story's own stack and will not exist
 * elsewhere (`e2e/CLAUDE.md`'s container-name gotcha).
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-shell9-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface NavContextFixture {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  projectId: string;
  /**
   * The seeded Project's real `name`. TC-SHELL-032 requires asserting the
   * breadcrumb "against a seeded fixture's actual name string, not a
   * placeholder" — the name carries a random suffix, so the test cannot use a
   * literal.
   */
  projectName: string;
  testPlanId: string;
}

/**
 * org_admin + Organization + active OrgMembership + org-wide `org_admin`
 * RoleAssignment, one Project, and one TestPlan under it (so one *nested*
 * project-scoped route can be exercised in a real browser too, not only
 * `ProjectDetail`).
 *
 * A single active `OrgMembership` is what makes `Login.tsx` land straight on
 * `OrgHome` (`org_context: "auto"`), same convention as
 * `shell2-breadcrumb-coverage.spec.ts`/`project-create.spec.ts`.
 *
 * `User(name=..., email=..., password_hash=...)` is constructed directly —
 * never `Actor()` then `User(actor_id=...)` (`backend/CLAUDE.md`'s
 * joined-table-inheritance trap) — and the email uses a real-shaped
 * `@example.com` domain, since `POST /auth/login`'s `EmailStr` rejects the
 * IANA reserved TLDs with a 422 that reads exactly like a wrong password.
 */
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import TestPlan, TestPlanStatus
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-shell9-nav-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="SHELL-9 Nav Context E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="SHELL-9 Nav Context E2E Org", slug=f"shell9-nav-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        project = Project(org_id=org.id, name=f"SHELL-9 Nav Context E2E Project {suffix}")
        session.add(project)
        await session.flush()

        plan = TestPlan(
            project_id=project.id,
            created_by_actor_id=user.actor_id,
            identifier=f"SHELL-9 Nav Context E2E Plan {suffix}",
            scope="Seeded for the SHELL-9 project-scope nav context E2E spec",
            status=TestPlanStatus.draft,
        )
        session.add(plan)
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
        }))

asyncio.run(main())
`;

/**
 * FK-safe, child-first cleanup taking `(user_id, org_id, project_id)` as
 * `sys.argv` — same shape and ordering as this repo's other per-story cleanup
 * scripts. No TestCycles are seeded here, so the RESTRICT-ordered
 * cycle-before-plan dance `shell2-breadcrumb-coverage.spec.ts` needs does not
 * apply; plans still go before their project.
 */
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.planning import TestPlan
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id, project_id = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(TestPlan).where(TestPlan.project_id == project_id))
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

function cleanup(fixture: NavContextFixture): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", fixture.userId, fixture.orgId, fixture.projectId],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

/**
 * `page.goto` to a protected route, then wait for the shell to actually mount.
 *
 * On a *full page load* (as opposed to a client-side `<Link>` click),
 * `ProtectedRoute` renders only a boot spinner until `AuthContext`'s silent
 * refresh round-trips — `AppShell`, and therefore `AppSidebar`, does not exist
 * in the DOM at all until then. Racing that with a plain 5s assertion fails
 * with "element(s) not found", which reads exactly like an unresolved nav
 * rather than a page that simply hadn't booted yet. Same helper shape as
 * `shell2-breadcrumb-coverage.spec.ts`'s, waiting on `aside.navbar-vertical` (which the
 * component renders unconditionally, even in its empty-nav state) rather than
 * on any nav item, so that a genuinely-unresolved sidebar still fails the
 * assertions below instead of hanging here.
 */
async function gotoProtected(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator("aside.navbar-vertical").waitFor({ state: "attached", timeout: 60_000 });
}

test.describe("SHELL-9: project-scope nav context (sidebar + breadcrumb)", () => {
  /**
   * Same environment-speed allowance `shell2-breadcrumb-coverage.spec.ts`
   * documents: `docker exec -i <backend> python -` cold-starts an interpreter
   * and imports SQLAlchemy + the model tree twice (seed, then cleanup),
   * measured in tens of seconds on this stack, and the three TCs share one
   * fixture rather than paying that cost three times. Every `expect` below
   * still runs on Playwright's own short default.
   */
  test.describe.configure({ timeout: 180_000 });

  test("TC-SHELL-029/031/032: project routes resolve the full org nav, a real trail, and a way back", async ({
    page,
  }) => {
    const fixture = runBackendPython<NavContextFixture>(SEED_SCRIPT);
    try {
      const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
      const crumbs = breadcrumb.getByRole("listitem");

      // --- Log in through the real login form ---------------------------------
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await expect(page.getByTestId("sidebar-nav-org-home")).toBeVisible();

      // =======================================================================
      // TC-SHELL-029 — direct landing at /projects/:projectId
      //
      // "Navigate directly to `/projects/:projectId` (no prior in-session visit
      // to `/orgs/:orgId`)". `page.goto` is a full document load: the SPA is
      // torn down and rebooted from scratch at the project URL, so no
      // client-side state at all survives from the login navigation above —
      // which is precisely the case that would otherwise let a stale in-memory
      // `orgId` mask a real resolution gap.
      //
      // **Revised 2026-09-09 (SHELL-10, ADR-0050):** the expected nav here is
      // now the project-mode nav (4 entity groups + "Back to Projects"), NOT
      // "identical to the org nav" — SHELL-10 makes project-scoped routes
      // render a distinct nav from org-scoped ones. The negative half (org nav
      // absent) is exactly the defect-shaped assertion this revision exists to
      // prove, same posture as every other "confirm the OLD behavior is gone,
      // not just that new behavior exists" check in this repo's history.
      // =======================================================================
      await gotoProtected(page, `/projects/${fixture.projectId}`);

      await expect(page.getByTestId("sidebar-nav-group-test-design")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-group-test-planning")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-group-execution-defects")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-group-setup")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-back-to-projects")).toBeVisible();
      // Already on `/projects/:projectId` itself — "Overview" still renders
      // (moved to the top of the nav, renamed from "Project Overview"), just
      // active-styled rather than suppressed as a dead self-link.
      await expect(page.getByTestId("sidebar-nav-project-overview")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-project-overview")).toHaveClass(/active/);

      // The org nav this story used to render here is gone — not just
      // "additional content exists," the old content is actually absent.
      await expect(page.getByTestId("sidebar-nav-org-home")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-nav-group-access-control")).toHaveCount(0);

      // Resolution came from the Project row's own `org_id` — nothing in this
      // URL contains an org id at all. Proven via the one project-mode item
      // that needs it: the back-link's own href.
      await expect(page.getByTestId("sidebar-nav-back-to-projects")).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}/projects`,
      );

      // =======================================================================
      // TC-SHELL-032 — the resolved breadcrumb trail, against the REAL name
      //
      // `/projects/:projectId`: `Projects` (linked) -> `{name}` (active).
      // =======================================================================
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(0)).toHaveText("Projects");
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);
      await expect(breadcrumb.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute(
        "href",
        `/orgs/${fixture.orgId}/projects`,
      );
      const activeCrumb = breadcrumb.locator("li.breadcrumb-item.active");
      await expect(activeCrumb).toHaveText(fixture.projectName);
      await expect(activeCrumb).toHaveAttribute("aria-current", "page");
      await expect(activeCrumb.getByRole("link")).toHaveCount(0);
      // "never the old bare unlinked 'Project' label" — the TC's own negative.
      await expect(breadcrumb.getByText("Project", { exact: true })).toHaveCount(0);

      // A nested project-scoped pattern in a real browser too, so TC-SHELL-032's
      // "and each of its nested route patterns" isn't proven only in jsdom:
      // `Projects -> {name} -> Test Plan`, with the name now itself a link.
      await gotoProtected(
        page,
        `/projects/${fixture.projectId}/test-plans/${fixture.testPlanId}`,
      );
      await expect(crumbs).toHaveCount(3);
      await expect(crumbs.nth(0)).toHaveText("Projects");
      await expect(crumbs.nth(1)).toHaveText(fixture.projectName);
      await expect(crumbs.nth(2)).toHaveText("Test Plan");
      await expect(
        breadcrumb.getByRole("link", { name: fixture.projectName, exact: true }),
      ).toHaveAttribute("href", `/projects/${fixture.projectId}`);
      // The sidebar resolved independently on this route too (its own mount) —
      // and, being a NESTED route (not `/projects/:projectId` itself), "Project
      // Overview" is present here, unlike on the bare project route above.
      await expect(page.getByTestId("sidebar-nav-group-test-design")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-project-overview")).toBeVisible();
      await expect(page.getByTestId("sidebar-nav-project-overview")).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}`,
      );

      // =======================================================================
      // TC-SHELL-031 — the way back out of a project
      //
      // "On any project-scoped screen, click the sidebar's back link -> URL
      // becomes `/orgs/:orgId/projects` with the project's correct `org_id`;
      // `ProjectsPage` renders." Asserted with a REAL click and a real
      // navigation, not an `href` string — an `href` that never navigates
      // would pass an attribute check while leaving the dead end intact, which
      // is the exact defect this story exists to fix.
      //
      // **Revised 2026-09-09 (SHELL-10, ADR-0050):** the click target is now
      // "Back to Projects" (bottom of the project-mode nav) — PROJ-4's own
      // `sidebar-nav-projects` item this test originally clicked no longer
      // renders on a project-scoped route at all, since SHELL-10 replaces the
      // org nav wholesale rather than layering on top of it.
      // =======================================================================
      await gotoProtected(page, `/projects/${fixture.projectId}`);
      await page.getByTestId("sidebar-nav-back-to-projects").click();

      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}/projects$`));
      // `ProjectsPage` really rendered...
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      // ...and it is the project's OWN org's list — the seeded project is in it.
      await expect(page.getByText(fixture.projectName)).toBeVisible();
      // Breadcrumb followed too: this is now an org-scoped route again.
      await expect(crumbs).toHaveCount(2);
      await expect(crumbs.nth(0)).toHaveText("Dashboard");
      await expect(crumbs.nth(1)).toHaveText("Projects");
    } finally {
      cleanup(fixture);
    }
  });

  /**
   * SHELL-10 (ADR-0050), new coverage — the literal ask this story exists to
   * satisfy: the project-mode sidebar's entity-group children are real,
   * clickable links to the project's own CRUD screens (Requirement, Test
   * Case, Test Condition, etc.), not just visible labels. Clicking one must
   * land on the already-shipped generic-admin route and actually render it —
   * an `href` alone would pass even if the route were broken.
   */
  test("TC-SHELL-038: clicking a project-nav group's entity child navigates to its real CRUD screen", async ({
    page,
  }) => {
    const fixture = runBackendPython<NavContextFixture>(SEED_SCRIPT);
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(fixture.email);
      await page.getByLabel(/password/i).fill(fixture.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();
      await page.waitForURL(new RegExp(`/orgs/${fixture.orgId}`));

      await gotoProtected(page, `/projects/${fixture.projectId}`);

      // Open the "Test Design" group and click through to Requirements. Same
      // toggle-then-child pattern already established for the org side's own
      // groups (`shell7-sidebar-mini.spec.ts`, retired by ADR-0054 alongside
      // the `sidebar-mini` feature it tested).
      await page
        .getByTestId("sidebar-nav-group-test-design")
        .getByRole("link", { name: "Test Design" })
        .click();
      const requirementsLink = page.getByTestId("sidebar-nav-admin-requirements");
      await expect(requirementsLink).toBeVisible();
      await expect(requirementsLink).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}/admin/requirements`,
      );
      await requirementsLink.click();

      await page.waitForURL(new RegExp(`/projects/${fixture.projectId}/admin/requirements$`));
      // The real generic-admin screen rendered, not a 404/blank route.
      await expect(page.getByRole("heading", { name: "Requirements" })).toBeVisible();
      // Breadcrumb followed too: `Projects -> {name} -> Requirements`.
      const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
      await expect(breadcrumb.getByRole("listitem")).toHaveCount(3);
      await expect(breadcrumb.getByRole("listitem").nth(2)).toHaveText("Requirements");
    } finally {
      cleanup(fixture);
    }
  });
});
