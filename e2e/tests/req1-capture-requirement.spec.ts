import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * REQ-1 E2E (`Requirement.title`, ADR-0024): full-stack smoke test of
 * TC-REQ-001 (capture a requirement, `title` required and round-tripped)
 * and TC-REQ-002 (search by `title` substring via `?q=`, vs. exact-match
 * `?external_ref=`) through the real deployed stack (nginx -> backend ->
 * Postgres) from `docs/test-cases/2026-09-03-test-cases.md`.
 *
 * **This is an API-level E2E test, not a browser UI flow** — same posture,
 * and same reason, as `admin2-generic-crud.spec.ts`: there is no frontend
 * UI for creating/searching Requirements in this codebase (confirmed
 * absent by design during this story's planning; no story asked for one).
 * It uses Playwright's `request` API context only, no `page` navigation.
 * This still proves the whole isolated stack end to end — a real network
 * hop through nginx, a real Postgres, not a mocked layer — it just proves
 * it as a black-box HTTP client rather than a browser click-through.
 * Rewrite to drive a UI if/when a future story ships one.
 *
 * Fixture seeding: one org_admin (one Organization/Project), same
 * `docker exec ... python -` pattern `admin2-generic-crud.spec.ts` /
 * `project-create.spec.ts` established.
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
    email = f"e2e-req1-{suffix}@example.com"
    async with AsyncSessionLocal() as session:
        user = User(name="REQ-1 E2E Org Admin", email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        await session.flush()
        session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

        org = Organization(name="REQ-1 E2E Org", slug=f"req1-e2e-{suffix}")
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

// FK-safe delete order (child-first), mirroring test_requirements_title.py's `_cleanup`.
const CLEANUP_SCRIPT = `
import asyncio, json, sys
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement
from app.models.auth import AuthIdentity, RefreshToken
from app.models.project import Project
from app.models.rbac import RoleAssignment
from app.models.tenancy import Organization, OrgMembership

user_id, org_id = sys.argv[1], sys.argv[2]
project_ids = json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else []
requirement_ids = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else []

async def main():
    async with AsyncSessionLocal() as session:
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

function cleanup(admin: SeededOrgAdmin, projectIds: string[], requirementIds: string[] = []): void {
  execFileSync(
    "docker",
    ["exec", "-i", BACKEND_CONTAINER, "python", "-", admin.userId, admin.orgId, JSON.stringify(projectIds), JSON.stringify(requirementIds)],
    { input: CLEANUP_SCRIPT, encoding: "utf-8" },
  );
}

test.describe("REQ-1: Requirement.title, full stack via nginx", () => {
  test("TC-REQ-001: capture a requirement with title, round-trips; missing title -> 422", async ({ request }) => {
    const admin = seedOrgAdmin();
    const projectIds: string[] = [];
    const requirementIds: string[] = [];

    try {
      const login = await request.post("/api/v1/auth/login", {
        data: { email: admin.email, password: admin.password },
      });
      expect(login.ok()).toBeTruthy();
      const token = (await login.json()).access_token as string;

      const projectResponse = await request.post(`/api/v1/orgs/${admin.orgId}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `REQ-1 E2E Project ${Date.now().toString(36)}` },
      });
      expect(projectResponse.ok()).toBeTruthy();
      const project = await projectResponse.json();
      projectIds.push(project.id);

      // --- TC-REQ-001: title (+description/source/external_ref) round-trips on create --
      const title = `REQ-1 E2E requirement ${Date.now().toString(36)}`;
      const externalRef = `JIRA-E2E-${Date.now().toString(36)}`;
      const createResponse = await request.post("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          project_id: project.id,
          title,
          description: "REQ-1 E2E requirement description",
          source: "stakeholder interview",
          external_ref: externalRef,
        },
      });
      expect(createResponse.status()).toBe(201);
      const requirement = await createResponse.json();
      requirementIds.push(requirement.id);
      expect(requirement.title).toBe(title);
      expect(requirement.project_id).toBe(project.id);

      // --- title required: missing on create -> 422 -------------------------------------
      const missingTitleResponse = await request.post("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${token}` },
        data: { project_id: project.id, description: "No title given" },
      });
      expect(missingTitleResponse.status()).toBe(422);

      // --- TC-REQ-002: search by title substring (?q=) -----------------------------------
      const searchResponse = await request.get("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${token}` },
        params: { project_id: project.id, q: title },
      });
      expect(searchResponse.ok()).toBeTruthy();
      const searchBody = await searchResponse.json();
      expect(searchBody.items.map((item: { id: string }) => item.id)).toContain(requirement.id);

      // --- TC-REQ-002: exact-match ?external_ref= -- a substring of it must NOT match ----
      const exactRefResponse = await request.get("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${token}` },
        params: { project_id: project.id, external_ref: externalRef },
      });
      expect(exactRefResponse.ok()).toBeTruthy();
      const exactRefBody = await exactRefResponse.json();
      expect(exactRefBody.items.map((item: { id: string }) => item.id)).toEqual([requirement.id]);

      const substringRefResponse = await request.get("/api/v1/requirements", {
        headers: { Authorization: `Bearer ${token}` },
        params: { project_id: project.id, external_ref: externalRef.slice(0, -2) },
      });
      expect(substringRefResponse.ok()).toBeTruthy();
      const substringRefBody = await substringRefResponse.json();
      expect(substringRefBody.items.map((item: { id: string }) => item.id)).not.toContain(requirement.id);
    } finally {
      cleanup(admin, projectIds, requirementIds);
    }
  });
});
