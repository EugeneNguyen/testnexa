import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * RBAC-3 E2E (ADR-0021): real deployed stack (nginx -> backend -> real
 * Postgres), exercising `POST`/`GET /orgs/{org_id}/role-assignments` plus
 * the now-`project_id`-aware `GET`/`PATCH /projects/{id}` end to end —
 * org-wide grants working across every Project in the org, project-scoped
 * grants confined to their own Project, and an `AIAgent` grantee resolving
 * identically to a human `User` grantee.
 *
 * RBAC-3 ships no frontend UI (same posture AUTH-4/PROJ-1's own specs take
 * for API-only stories) — these are API-request-based tests, using
 * Playwright's `request` fixture (configured against `E2E_BASE_URL`,
 * `playwright.config.ts`) rather than `page` navigation.
 *
 * Fixture seeding mirrors `auth-agents.spec.ts`/`project-create.spec.ts`'s
 * established convention: a seed script run inside the target env's own
 * backend container (`docker exec ... python -`), since there is no invite
 * API yet (RBAC-2 unbuilt) to add a second member to an org any other way.
 * Everything else — Projects, the `AIAgent` credential, every
 * `RoleAssignment` this spec proves the effect of — is created via real HTTP
 * calls against the routes under test, not seeded directly.
 *
 * Target environment: an isolated Compose project for this story
 * (`E2E_BASE_URL`), never the main `testnexa` stack. Container name
 * overridable via env var for portability.
 */

const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-rbac3-test-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededFixture {
  admin: { email: string; password: string; userId: string };
  granteeOrgWide: { email: string; password: string; userId: string };
  granteeProjectScoped: { email: string; password: string; userId: string };
  orgId: string;
  orgAdminRoleId: string;
  testManagerRoleId: string;
}

// Seeds one human org_admin (org-wide RoleAssignment against RBAC-4's
// seeded `org_admin` system Role) with an active OrgMembership in a fresh
// Organization, plus two further human Users with an active OrgMembership
// in the same org but ZERO RoleAssignment rows — the "grantee" actors this
// spec's own `POST /orgs/{org_id}/role-assignments` calls will grant roles
// to during the test body, proving the create route's effect rather than
// pre-seeding it. Also resolves the `org_admin`/`test_manager` system
// Role ids the test body needs for its `role_id` payloads.
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

async def _create_user(session, tag):
    suffix = uuid4().hex[:8]
    email = f"e2e-rbac3-{tag}-{suffix}@example.com"
    user = User(name=f"RBAC-3 E2E {tag}", email=email, password_hash=hash_password(PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    return user, email

async def main():
    async with AsyncSessionLocal() as session:
        admin, admin_email = await _create_user(session, "admin")

        org = Organization(name="RBAC-3 E2E Org", slug=f"rbac3-e2e-{uuid4().hex[:8]}")
        session.add(org)
        await session.flush()

        now = datetime.now(UTC)
        session.add(OrgMembership(org_id=org.id, user_id=admin.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        org_admin_role = (
            await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
        ).scalars().first()
        assert org_admin_role is not None, "expected the RBAC-4-seeded org_admin system Role to already exist"
        session.add(RoleAssignment(actor_id=admin.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))

        test_manager_role = (
            await session.execute(select(Role).where(Role.name == "test_manager", Role.org_id.is_(None)))
        ).scalars().first()
        assert test_manager_role is not None, "expected the RBAC-4-seeded test_manager system Role to already exist"

        grantee_org_wide, grantee_org_wide_email = await _create_user(session, "grantee-org-wide")
        session.add(OrgMembership(org_id=org.id, user_id=grantee_org_wide.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        grantee_project_scoped, grantee_project_scoped_email = await _create_user(session, "grantee-project-scoped")
        session.add(OrgMembership(org_id=org.id, user_id=grantee_project_scoped.actor_id, status=OrgMembershipStatus.active, joined_at=now))

        await session.commit()
        print(json.dumps({
            "admin": {"email": admin_email, "password": PASSWORD, "userId": str(admin.actor_id)},
            "granteeOrgWide": {"email": grantee_org_wide_email, "password": PASSWORD, "userId": str(grantee_org_wide.actor_id)},
            "granteeProjectScoped": {"email": grantee_project_scoped_email, "password": PASSWORD, "userId": str(grantee_project_scoped.actor_id)},
            "orgId": str(org.id),
            "orgAdminRoleId": str(org_admin_role.id),
            "testManagerRoleId": str(test_manager_role.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_role_assignments.py's/test_projects.py's
// own `_cleanup` helpers. `agentId`/`projectIds` may be empty if the test
// failed before creating them.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

admin_id, grantee_org_wide_id, grantee_project_scoped_id, org_id, agent_id = sys.argv[1:6]
project_ids = json.loads(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else []

async def main():
    async with AsyncSessionLocal() as session:
        user_ids = [admin_id, grantee_org_wide_id, grantee_project_scoped_id]
        actor_ids = user_ids + ([agent_id] if agent_id else [])
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids)))
        await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id == org_id))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if agent_id:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id == agent_id))
            await session.execute(delete(Actor).where(Actor.id == agent_id))
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(user_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
        await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
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

function cleanup(fixture: SeededFixture, agentId: string | null, projectIds: string[]): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      BACKEND_CONTAINER,
      "python",
      "-",
      fixture.admin.userId,
      fixture.granteeOrgWide.userId,
      fixture.granteeProjectScoped.userId,
      fixture.orgId,
      agentId ?? "",
      JSON.stringify(projectIds),
    ],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

async function login(request: import("@playwright/test").APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post("/api/v1/auth/login", { data: { email, password } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.access_token as string;
}

test.describe("RBAC-3 role assignments: org-wide vs. project-scoped enforcement", () => {
  test("org-wide grant works across every project; project-scoped grant is confined to its own project; an AIAgent grantee resolves identically (TC-RBAC-008/009/011/024/025)", async ({
    request,
  }) => {
    const fixture = seedFixture();
    let agentId: string | null = null;
    const projectIds: string[] = [];

    try {
      const adminToken = await login(request, fixture.admin.email, fixture.admin.password);
      const adminHeaders = { Authorization: `Bearer ${adminToken}` };

      // --- Create 2 Projects as the org_admin -------------------------------------------
      const projectAResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/projects`, {
        headers: adminHeaders,
        data: { name: `RBAC-3 E2E Project A ${Date.now().toString(36)}` },
      });
      expect(projectAResponse.status()).toBe(201);
      const projectAId: string = (await projectAResponse.json()).id;
      projectIds.push(projectAId);

      const projectBResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/projects`, {
        headers: adminHeaders,
        data: { name: `RBAC-3 E2E Project B ${Date.now().toString(36)}` },
      });
      expect(projectBResponse.status()).toBe(201);
      const projectBId: string = (await projectBResponse.json()).id;
      projectIds.push(projectBId);

      // --- TC-RBAC-024/008: grant org-wide org_admin to granteeOrgWide, project_id omitted
      const orgWideGrantResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/role-assignments`, {
        headers: adminHeaders,
        data: { actor_id: fixture.granteeOrgWide.userId, role_id: fixture.orgAdminRoleId },
      });
      expect(orgWideGrantResponse.status()).toBe(201);
      const orgWideGrantBody = await orgWideGrantResponse.json();
      expect(orgWideGrantBody.project_id).toBeNull();

      const granteeOrgWideToken = await login(request, fixture.granteeOrgWide.email, fixture.granteeOrgWide.password);
      const granteeOrgWideHeaders = { Authorization: `Bearer ${granteeOrgWideToken}` };

      // Every project in the org, not just one.
      for (const projectId of [projectAId, projectBId]) {
        const getResponse = await request.get(`/api/v1/projects/${projectId}`, { headers: granteeOrgWideHeaders });
        expect(getResponse.status()).toBe(200);

        const patchResponse = await request.patch(`/api/v1/projects/${projectId}`, {
          headers: granteeOrgWideHeaders,
          data: { name: `RBAC-3 E2E Renamed ${projectId}` },
        });
        expect(patchResponse.status()).toBe(200);
      }

      // --- TC-RBAC-025/009: grant test_manager scoped to Project A only for granteeProjectScoped
      const projectScopedGrantResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/role-assignments`, {
        headers: adminHeaders,
        data: {
          actor_id: fixture.granteeProjectScoped.userId,
          role_id: fixture.testManagerRoleId,
          project_id: projectAId,
        },
      });
      expect(projectScopedGrantResponse.status()).toBe(201);
      const projectScopedGrantBody = await projectScopedGrantResponse.json();
      expect(projectScopedGrantBody.project_id).toBe(projectAId);

      const granteeProjectScopedToken = await login(
        request,
        fixture.granteeProjectScoped.email,
        fixture.granteeProjectScoped.password,
      );
      const granteeProjectScopedHeaders = { Authorization: `Bearer ${granteeProjectScopedToken}` };

      const getAResponse = await request.get(`/api/v1/projects/${projectAId}`, { headers: granteeProjectScopedHeaders });
      expect(getAResponse.status()).toBe(200);

      const patchAResponse = await request.patch(`/api/v1/projects/${projectAId}`, {
        headers: granteeProjectScopedHeaders,
        data: { name: "RBAC-3 E2E Project A Renamed" },
      });
      expect(patchAResponse.status()).toBe(200);

      // No implicit access to Project B (same org, no separate grant).
      const getBResponse = await request.get(`/api/v1/projects/${projectBId}`, { headers: granteeProjectScopedHeaders });
      expect(getBResponse.status()).toBe(403);
      expect((await getBResponse.json()).code).toBe("permission_denied");

      // --- TC-RBAC-011/032: an AIAgent grantee resolves identically -----------------------
      const createAgentResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/agents`, {
        headers: adminHeaders,
        data: { agent_name: "RBAC-3 E2E Agent", acting_on_behalf_of_user_id: fixture.admin.userId },
      });
      expect(createAgentResponse.status()).toBe(201);
      const createAgentBody = await createAgentResponse.json();
      agentId = createAgentBody.agent_id;
      const agentApiKey: string = createAgentBody.api_key;

      // Grant the agent a project-scoped test_manager role on Project A —
      // the User-actor OrgMembership gate (ADR-0021) is skipped entirely
      // for an AIAgent actor, so this must succeed even though the agent
      // has no OrgMembership row at all.
      const agentGrantResponse = await request.post(`/api/v1/orgs/${fixture.orgId}/role-assignments`, {
        headers: adminHeaders,
        data: { actor_id: agentId, role_id: fixture.testManagerRoleId, project_id: projectAId },
      });
      expect(agentGrantResponse.status()).toBe(201);

      const agentHeaders = { Authorization: `Bearer ${agentApiKey}` };

      // Same scoping outcome as the human project-scoped grantee: Project A
      // succeeds, Project B 403s.
      const agentGetAResponse = await request.get(`/api/v1/projects/${projectAId}`, { headers: agentHeaders });
      expect(agentGetAResponse.status()).toBe(200);

      const agentGetBResponse = await request.get(`/api/v1/projects/${projectBId}`, { headers: agentHeaders });
      expect(agentGetBResponse.status()).toBe(403);
      expect((await agentGetBResponse.json()).code).toBe("permission_denied");
    } finally {
      cleanup(fixture, agentId, projectIds);
    }
  });
});
