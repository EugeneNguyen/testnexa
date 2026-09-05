import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * ADMIN-2 E2E (ADR-0021): full-stack smoke test of the generic CRUD router
 * factory through the real deployed stack (nginx -> backend -> Postgres),
 * proving it end to end the way `scaffold-smoke.spec.ts` proves the base
 * stack wires together — not a re-run of every case
 * `backend/tests/integration/test_admin2_crud.py` already covers
 * exhaustively at the HTTP-client level.
 *
 * **Deviation from this repo's other E2E specs, flagged explicitly:** every
 * other spec here drives a real browser page (`page.goto`, `page.getByRole`,
 * ...). This one uses Playwright's `request` API context only, no `page`
 * navigation — the frontend has no generic-CRUD UI yet (WBS §7:
 * `<EntityTable>`/`<EntityForm>`/`entityConfigs/` is unbuilt;
 * `frontend/src/entityConfigs/` is a placeholder `README.md` only). There is
 * no screen to click through for `Requirement`/`TestCondition`/etc. yet.
 * This is the documented interim substitute the ADMIN-2 plan names for
 * exactly this situation: an E2E-level API test against the real stack,
 * not a browser-driven one. Rewrite to drive the UI once WBS §7 ships.
 *
 * Fixture seeding: two org_admins (two isolated Organizations), same
 * `docker exec ... python -` pattern `project-create.spec.ts`/
 * `org-create-second.spec.ts` established.
 *
 * Target environment: whichever isolated Compose project `E2E_BASE_URL`
 * points at (never the main `testnexa` stack) — `E2E_BACKEND_CONTAINER`
 * names its backend container for the seed/cleanup `docker exec` calls.
 */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-test-32500-backend-1";
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
    email = f"e2e-admin2-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="ADMIN-2 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="ADMIN-2 E2E Org", slug=f"admin2-e2e-{suffix}")
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

// FK-safe delete order (child-first), mirroring test_admin2_crud.py's `_cleanup`.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCondition
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id = sys.argv[1], sys.argv[2]
project_ids = json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else []
requirement_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []
test_condition_ids = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else []

async def main():
    async with AsyncSessionLocal() as session:
        if test_condition_ids:
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(test_condition_ids)))
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
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

function cleanup(
  admin: SeededOrgAdmin,
  projectIds: string[],
  requirementIds: string[] = [],
  testConditionIds: string[] = [],
): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      admin.userId,
      admin.orgId,
      JSON.stringify(projectIds),
      JSON.stringify(requirementIds),
      JSON.stringify(testConditionIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("ADMIN-2: generic CRUD router factory, full stack via nginx", () => {
  test("create Requirement -> TestCondition through nginx, then cross-org 404", async ({ request }) => {
    const adminA = seedOrgAdmin();
    const adminB = seedOrgAdmin();
    const projectIds: string[] = [];
    const requirementIds: string[] = [];
    const testConditionIds: string[] = [];

    try {
      // --- Org A: log in, create a Project (bespoke route, untouched by ADR-0021) -------
      const loginA = await request.post("/api/v1/auth/login", {
        data: { email: adminA.email, password: adminA.password },
      });
      expect(loginA.ok()).toBeTruthy();
      const tokenA = (await loginA.json()).access_token as string;

      const projectResponse = await request.post(`/api/v1/orgs/${adminA.orgId}/projects`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: `ADMIN-2 E2E Project ${Date.now().toString(36)}` },
      });
      expect(projectResponse.ok()).toBeTruthy();
      const project = await projectResponse.json();
      projectIds.push(project.id);

      // --- Generic factory: create a Requirement scoped to that Project -----------------
      const requirementResponse = await request.post("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { project_id: project.id, description: "ADMIN-2 E2E requirement" },
      });
      expect(requirementResponse.ok()).toBeTruthy();
      const requirement = await requirementResponse.json();
      requirementIds.push(requirement.id);
      expect(requirement.project_id).toBe(project.id);

      // --- One more hop: TestCondition scoped to that Requirement -----------------------
      const conditionResponse = await request.post("/api/v1/test-conditions", {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { requirement_id: requirement.id, description: "ADMIN-2 E2E condition", priority: "medium" },
      });
      expect(conditionResponse.ok()).toBeTruthy();
      const condition = await conditionResponse.json();
      testConditionIds.push(condition.id);

      // --- List, scoped by project_id, finds the Requirement we just created ------------
      const listResponse = await request.get("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${tokenA}` },
        params: { project_id: project.id },
      });
      expect(listResponse.ok()).toBeTruthy();
      const listBody = await listResponse.json();
      expect(listBody.items.map((item: { id: string }) => item.id)).toContain(requirement.id);

      // --- Cross-org 404: Org B's admin can't see Org A's Requirement (NFR-1/NFR-31) ----
      const loginB = await request.post("/api/v1/auth/login", {
        data: { email: adminB.email, password: adminB.password },
      });
      expect(loginB.ok()).toBeTruthy();
      const tokenB = (await loginB.json()).access_token as string;

      const crossOrgResponse = await request.get(`/api/v1/requirements/${requirement.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      expect(crossOrgResponse.status()).toBe(404);
      expect((await crossOrgResponse.json()).code).toBe("not_found");

      // --- RESTRICT-delete: TestCondition still referenced (indirectly reachable via
      // its Requirement, no TestCase here) deletes cleanly once nothing blocks it ------
      const deleteConditionResponse = await request.delete(`/api/v1/test-conditions/${condition.id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(deleteConditionResponse.status()).toBe(204);
      testConditionIds.length = 0; // already gone
    } finally {
      cleanup(adminA, projectIds, requirementIds, testConditionIds);
      cleanup(adminB, []);
    }
  });
});
