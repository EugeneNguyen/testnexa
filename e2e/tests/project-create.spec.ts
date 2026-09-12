import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * PROJ-1 E2E (ADR-0017): real browser, full stack, exercising Project
 * create + edit through the UI — an already-authenticated org_admin
 * creating a Project and then editing it, mirroring
 * `org-create-second.spec.ts`'s conventions exactly (fixture seeding via
 * `docker exec ... python -` against the target env's own backend
 * container, FK-safe cleanup script, page-object-free role/label
 * selectors).
 *
 * **Revised [ADR-0060](../../docs/adr/0060-projects-page-retired-generic-surface.md):**
 * the screen under test has moved twice since this spec was first written —
 * `OrgHome.tsx`'s own "New Project" modal (PROJ-1) → the bespoke
 * `ProjectsPage`'s own modal (PROJ-4/ADR-0047, DASH-2's edit-modal upgrade
 * carried over unchanged) → the generic admin surface's `EntityListPage`
 * create-modal/`EntityFormPage` edit-route (ADR-0025/ADR-0058/ADR-0059,
 * this ADR). Same URL, same nav item — only the actual markup selectors
 * below changed: "New" not "New Project" (generic surface's own button
 * text), "Edit Projects" not "Edit Project" (plural — generic's `Edit
 * {label}` heading), "No records found." not "No projects yet" (generic
 * empty-state text). The row-name-links-to-`ProjectDetail` step near the
 * bottom needed no change — this ADR's own `detailPath`/`detailLinkField`
 * addition to `EntityTable` restores that exact behavior generically.
 *
 * Fixture seeding: a single human User who is org_admin (org-wide
 * RoleAssignment against RBAC-4's seeded `org_admin` system Role, which
 * grants `project.create`/`.read`/`.update` among everything else) of one
 * Organization, with exactly one active `OrgMembership` — one active
 * membership is what makes `POST /auth/login` resolve `org_context: "auto"`
 * (mirrors `auth-login.spec.ts`'s TC-AUTH precondition and `Login.tsx`'s own
 * `org_context === "auto" -> navigate("/orgs/{orgs[0].id}")` redirect),
 * landing straight on `OrgHome` through real UI navigation — no raw
 * `page.goto("/orgs/...")` needed.
 *
 * **Project-list fix (2026-09-07):** `OrgHome.tsx`'s Project list used to be
 * local component state only, populated purely from `createProject`'s own
 * response — any unmount (not just a reload; navigating into a project and
 * back unmounts `OrgHome` too) silently lost the whole list even though the
 * rows still existed server-side. Fixed by fetching real data via
 * `GET /projects?org_id=` (the generic-CRUD factory route ADR-0022 already
 * shipped). This spec now proves both persistence claims directly: the
 * Edit-modal `standards_profile` change persisted server-side via a direct
 * `GET /api/v1/projects/{id}` re-fetch through Playwright's `request`
 * context (a fresh `POST /api/v1/auth/login` call, independent of the
 * browser's own in-memory token store), **and** the literal reported bug —
 * navigate into the project's own detail page, then back — no longer empties
 * the list.
 *
 * Target environment: the isolated `testnexa-proj1-test` Compose project
 * (`E2E_BASE_URL`, set externally per this task's brief), never the main
 * `testnexa` stack. Container name overridable via env var for portability.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-proj1-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededOrgAdmin {
  email: string;
  password: string;
  userId: string;
  orgId: string;
}

const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-proj1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="PROJ-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="PROJ-1 E2E Org", slug=f"proj1-e2e-{suffix}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_projects.py's `_cleanup` helper.
// `projectIds` may be empty if the test never got far enough to create a
// project via the UI (e.g. it failed before submitting).
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id = sys.argv[1], sys.argv[2], sys.argv[3]
project_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == user_id))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id == user_id))
        await session.execute(delete(Actor).where(Actor.id == user_id))
        await session.commit()

asyncio.run(main())
`;

function seedOrgAdmin(): SeededOrgAdmin {
  const output = execFileSync("docker", ["exec", "-i", BACKEND_CONTAINER, "python", "-"], {
    input: SEED_SCRIPT,
    encoding: "utf-8",
  });
  return JSON.parse(output.trim()) as SeededOrgAdmin;
}

function cleanup(admin: SeededOrgAdmin, projectIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      admin.email,
      admin.userId,
      admin.orgId,
      JSON.stringify(projectIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("PROJ-1: create a Project via the Projects page's New modal", () => {
  test("create, list, and edit standards_profile via the Edit modal persists server-side", async ({ page, request }) => {
    // DASH-2's Edit modal adds a real mount/transition round trip on top of
    // an already-long multi-step flow (create, edit, independent GET
    // re-fetch, navigate-away-and-back) — the default 30s test timeout was
    // already close to the edge before this, and the extra modal
    // open/close pushed one run over it.
    test.setTimeout(60_000);
    const admin = seedOrgAdmin();
    const projectIds: string[] = [];
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(admin.email);
      await page.getByLabel(/password/i).fill(admin.password);
      await page.getByRole("button", { name: /log in|sign in/i }).click();

      // Single active OrgMembership -> org_context "auto" -> Login.tsx's own
      // redirect effect lands here automatically.
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}$`));
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

      // PROJ-4 (ADR-0047): Project CRUD moved off "Dashboard" onto its own
      // page, reached via the sidebar's "Projects" nav item.
      await page.getByTestId("sidebar-nav-projects").click();
      await page.waitForURL(new RegExp(`/orgs/${admin.orgId}/projects$`));
      await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
      await expect(page.getByText("No records found.")).toBeVisible();

      // --- Create a Project via the "New Project" modal ---------------------------------
      await page.getByRole("button", { name: "New" }).click();
      await expect(page.getByRole("heading", { name: /new project/i })).toBeVisible();

      const projectName = `PROJ-1 E2E Alpha ${Date.now().toString(36)}`;
      const initialProfile = "ISTQB-CTFL-v4.0.1 + ISO29119-3";
      await page.getByLabel(/^name$/i).fill(projectName);
      await page.getByLabel(/standards profile/i).fill(initialProfile);

      // Capture the create response's own `id` — OrgHome never renders it in
      // the DOM (see the Project list docstring), and it's needed below for
      // the persistence re-fetch and for FK-safe cleanup.
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes(`/api/v1/orgs/${admin.orgId}/projects`) && response.request().method() === "POST",
        ),
        page.getByRole("button", { name: /^create$/i }).click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const createdProject = await createResponse.json();
      projectIds.push(createdProject.id);

      // Modal closes, new row appears with the submitted values.
      await expect(page.getByRole("heading", { name: /new project/i })).not.toBeVisible();
      const row = page.getByRole("row", { name: new RegExp(projectName) });
      await expect(row).toBeVisible();
      await expect(row.getByText(initialProfile)).toBeVisible();

      // --- Edit standards_profile via the "Edit Project" modal --------------------------
      const updatedProfile = "ISO29119-3 only";
      await row.getByRole("button", { name: /^edit$/i }).click();

      await expect(page.getByRole("heading", { name: /^edit projects$/i })).toBeVisible();
      // Pre-filled with the current name/profile — only the profile field changes here.
      await expect(page.getByLabel(/^name$/i)).toHaveValue(projectName);
      const profileField = page.getByLabel(/standards profile/i);
      await profileField.fill(updatedProfile);
      await page.getByRole("button", { name: /^save$/i }).click();

      // Modal closes -> row shows the new value.
      await expect(page.getByRole("heading", { name: /^edit projects$/i })).not.toBeVisible();
      await expect(row.getByText(updatedProfile)).toBeVisible();
      await expect(row.getByText(initialProfile)).not.toBeVisible();

      // --- Prove the edit persisted server-side, not just in React state ----------------
      // Re-fetch independently of the browser's own in-memory query cache —
      // a fresh login + GET /projects/{id} via Playwright's own `request`
      // context — rather than trusting the row's rendered value, which could
      // in principle be showing an optimistic client-side write that never
      // actually round-tripped through the server.
      const loginResponse = await request.post("/api/v1/auth/login", {
        data: { email: admin.email, password: admin.password },
      });
      expect(loginResponse.ok()).toBeTruthy();
      const { access_token: accessToken } = await loginResponse.json();

      const getResponse = await request.get(`/api/v1/projects/${createdProject.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(getResponse.ok()).toBeTruthy();
      const persisted = await getResponse.json();
      expect(persisted.name).toBe(projectName);
      expect(persisted.standards_profile).toBe(updatedProfile);

      // --- The literal reported bug: navigate into the project, then back --------------
      // Before the fix, the Project list was local-only state — navigating
      // away unmounted it, and coming back rendered an empty list even
      // though the project still existed. Reproduced here exactly as
      // reported: click into the project's own detail page, then
      // browser-back to the Projects page (PROJ-4: was OrgHome/Dashboard;
      // the list itself, and this regression's own fix, are unchanged).
      await row.getByRole("link", { name: projectName }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${createdProject.id}$`));

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/orgs/${admin.orgId}/projects$`));
      await expect(page.getByRole("row", { name: new RegExp(projectName) })).toBeVisible();
      await expect(page.getByText("No records found.")).not.toBeVisible();
    } finally {
      cleanup(admin, projectIds);
    }
  });
});
