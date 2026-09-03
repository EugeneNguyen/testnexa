import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * AUTH-4 E2E: real deployed stack (nginx -> backend -> real Postgres),
 * exercising the full AI-agent bearer-credential lifecycle (ADR-0015):
 * human login -> issue an agent credential -> the agent's raw key resolves
 * via `GET /auth/me` -> revoke -> the same raw key immediately 401s.
 *
 * AUTH-4 deliberately ships no frontend UI (story note: "story deprioritizes
 * UX polish for this flow; backend mechanism + API only" — AUTH-4 scope
 * plan §1). These tests are therefore API-request-based, using Playwright's
 * `request` fixture (configured against `E2E_BASE_URL`/`playwright.config.ts`,
 * same base URL every other spec in this directory uses) rather than
 * `page` navigation — there is no screen to click through.
 *
 * Fixture seeding mirrors `auth-agents.spec.ts`'s sibling
 * `auth-refresh.spec.ts`'s established convention exactly: a seed script run
 * inside the target env's own backend container (`docker exec ... python -`),
 * since there is no bootstrap API for `Role`/`Permission`/`RoleAssignment`
 * (RBAC-1..5 are unbuilt) and no other seed mechanism in this repo's `e2e/`
 * package to reuse. The `ai_agent.create`/`ai_agent.update` `Permission`
 * catalog rows themselves are NOT seeded here — they already exist via the
 * backend's own Alembic data migration (`d33d66f4b3c3_seed_ai_agent_permissions`,
 * ADR-0015) in any environment running this backend; the seed script only
 * looks them up by `code` and grants them to a fresh `Role`/`RoleAssignment`
 * pair for a fresh human `User`, matching the same fixture-bypass precedent
 * `backend/tests/integration/test_agents.py` uses.
 *
 * Target environment: the isolated `testnexa-test-auth4` Compose project
 * (`E2E_BASE_URL`, default below matches its exposed port), never the main
 * `testnexa` stack. Container name overridable via env var for portability.
 */

const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "testnexa-test-auth4-backend-1";
const TEST_PASSWORD = "E2ETestPass123!";

interface SeededOrgAdmin {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  roleId: string;
}

// Seeds one human User (+ local AuthIdentity) with an active OrgMembership
// in a fresh Organization, plus a Role granting BOTH `ai_agent.create` and
// `ai_agent.update` (org-wide RoleAssignment, project_id=null) — the
// org_admin-equivalent fixture AUTH-4's own integration tests
// (`test_org_admin_equivalent_issues_and_revokes_agent_credential`,
// TC-AUTH-012) establish. Looks the two Permission rows up by `code` rather
// than creating them — they are seeded once, globally, by the backend's own
// Alembic data migration, not per-test fixture data.
const SEED_SCRIPT = `
import asyncio, json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

PASSWORD = "${TEST_PASSWORD}"

async def main():
    suffix = uuid4().hex[:8]
    email = f"e2e-auth4-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="AUTH-4 E2E Test User", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="AUTH-4 E2E Test Org", slug=f"auth4-e2e-{suffix}")
        session.add(org)
        await session.flush()
        session.add(
            OrgMembership(
                org_id=org.id,
                user_id=user.actor_id,
                status=OrgMembershipStatus.active,
                joined_at=datetime.now(UTC),
            )
        )

        create_perm = (
            await session.execute(select(Permission).where(Permission.code == "ai_agent.create"))
        ).scalars().first()
        update_perm = (
            await session.execute(select(Permission).where(Permission.code == "ai_agent.update"))
        ).scalars().first()
        assert create_perm is not None, "ai_agent.create catalog Permission must already be seeded"
        assert update_perm is not None, "ai_agent.update catalog Permission must already be seeded"

        role = Role(org_id=org.id, name="e2e-org-admin-equivalent", is_system_role=False)
        session.add(role)
        await session.flush()
        session.add(RolePermission(role_id=role.id, permission_id=create_perm.id))
        session.add(RolePermission(role_id=role.id, permission_id=update_perm.id))
        session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=role.id))

        await session.commit()
        print(json.dumps({
            "email": email,
            "password": PASSWORD,
            "userId": str(user.actor_id),
            "orgId": str(org.id),
            "roleId": str(role.id),
        }))

asyncio.run(main())
`;

// FK-safe delete order, mirroring test_agents.py's `_cleanup` helper.
// `agentId` may be an empty string if the test never got far enough to
// create one (e.g. it failed before issuance) — the script tolerates that.
const CLEANUP_SCRIPT = `
import asyncio, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, AIAgent, User
from app.models.auth import AuthIdentity, RefreshToken
from app.models.rbac import Role, RoleAssignment, RolePermission
from app.models.tenancy import Organization, OrgMembership

email, user_id, org_id, role_id, agent_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

async def main():
    async with AsyncSessionLocal() as session:
        actor_ids = [user_id] + ([agent_id] if agent_id else [])
        await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(actor_ids)))
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
        await session.execute(delete(Role).where(Role.id == role_id))
        if agent_id:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id == agent_id))
            await session.execute(delete(Actor).where(Actor.id == agent_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.user_id == user_id))
        await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == user_id))
        # The real login step in the test body issues a RefreshToken row for
        # this user (httpOnly-cookie session, ADR-0003) — must be deleted
        # before the User row itself, or the User delete 409s on the FK
        # (RefreshToken.user_id -> user.actor_id, ON DELETE RESTRICT).
        await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
        await session.execute(delete(OrgMembership).where(OrgMembership.org_id == org_id))
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

function cleanup(user: SeededOrgAdmin, agentId: string | null): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", user.email, user.userId, user.orgId, user.roleId, agentId ?? ""],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("AUTH-4 agent bearer credential lifecycle", () => {
  test("issue -> authenticate as the agent -> revoke -> the revoked key 401s (TC-AUTH-010/012)", async ({
    request,
  }) => {
    const admin = seedOrgAdmin();
    let agentId: string | null = null;
    try {
      // 1. Human login (AUTH-1 flow) — the existing, real login route.
      const loginResponse = await request.post("/api/v1/auth/login", {
        data: { email: admin.email, password: admin.password },
      });
      expect(loginResponse.status()).toBe(200);
      const loginBody = await loginResponse.json();
      const accessToken: string = loginBody.access_token;
      expect(accessToken).toBeTruthy();

      // 2. Issue an agent credential as the org_admin-equivalent human.
      const createResponse = await request.post(`/api/v1/orgs/${admin.orgId}/agents`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: {
          agent_name: "AUTH-4 E2E Agent",
          acting_on_behalf_of_user_id: admin.userId,
        },
      });
      expect(createResponse.status()).toBe(201);
      const createBody = await createResponse.json();
      agentId = createBody.agent_id;
      const rawApiKey: string = createBody.api_key;
      expect(rawApiKey).toMatch(/^tnx_agent_/);
      expect(createBody.key_prefix).toHaveLength(8);
      expect(rawApiKey.startsWith(`tnx_agent_${createBody.key_prefix}_`)).toBe(true);

      // 3. Call GET /auth/me with the agent's raw key — confirms
      // get_current_actor resolves the AIAgent, not the human User who
      // issued it (ADR-0015 AC1's mechanism-level proof, TC-AUTH-010).
      const meAsAgentResponse = await request.get("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${rawApiKey}` },
      });
      expect(meAsAgentResponse.status()).toBe(200);
      const meAsAgentBody = await meAsAgentResponse.json();
      expect(meAsAgentBody.actor_type).toBe("ai_agent");
      expect(meAsAgentBody.actor_id).toBe(agentId);
      expect(meAsAgentBody.agent_name).toBe("AUTH-4 E2E Agent");
      expect(meAsAgentBody.email).toBeUndefined();

      // 4. Revoke the credential as the human org_admin-equivalent again.
      const revokeResponse = await request.post(`/api/v1/orgs/${admin.orgId}/agents/${agentId}/revoke`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(revokeResponse.status()).toBe(200);
      const revokeBody = await revokeResponse.json();
      expect(revokeBody.agent_id).toBe(agentId);
      expect(revokeBody.revoked_at).toBeTruthy();

      // 5. The same raw key now 401s — revocation takes effect immediately,
      // no separate cache/blocklist to propagate (ADR-0015).
      const meAfterRevokeResponse = await request.get("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${rawApiKey}` },
      });
      expect(meAfterRevokeResponse.status()).toBe(401);
      const meAfterRevokeBody = await meAfterRevokeResponse.json();
      expect(meAfterRevokeBody.code).toBe("invalid_token");
    } finally {
      cleanup(admin, agentId);
    }
  });
});
