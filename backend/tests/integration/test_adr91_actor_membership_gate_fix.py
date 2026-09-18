"""Integration tests for ADR-0091: several bespoke MCP-reachable create
routes 404'd every `AIAgent` caller because they gated on the plain,
`AIAgent`-blind `_org_membership_exists(db, org_id, actor.actor_id)` instead
of `_actor_membership_exists(db, org_id, actor)` (the fix
`backend/CLAUDE.md`'s own standing rule already prescribes for any route
taking a `User | AIAgent` actor).

Found live: an `AIAgent` bearer session calling `tn_test_suite_test_case_create`
got `404 not_found` ("Test suite not found") against a real, existing test
suite it could `tn_test_suite_get` successfully — the tell that the 404 was a
membership-resolution bug, not a real "doesn't exist" state. Fixed in
`test_suite_membership.py`/`test_plan_membership.py` (blocking this
session's own task) and, on audit, five more genuinely broken sibling
routes: `projects.py::create_project`, `org_memberships.py::invite_member`,
`role_assignments.py::create_role_assignment`, `releases.py::create_release`,
`test_cycle_creation.py::create_test_cycle_for_plan` — plus two REST-only
(not MCP-registered) routes found in the same audit, `roles.py::list_roles`
and `rbac_routes.py`'s `GET /orgs/{org_id}/permissions/mine`.

Real HTTP requests via `httpx.AsyncClient` against a live server, seeding
fixtures directly through `AsyncSessionLocal` — this repo's established
integration-test shape. Each test proves the specific previously-broken path
now succeeds for a real `AIAgent` bearer key with a real active `OrgMembership`
only via its `acting_on_behalf_of_user_id` (never its own `Actor` row).
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.core.security import generate_api_key, hash_api_key, hash_password
from app.db.session import AsyncSessionLocal
from sqlalchemy import select

from app.models.actor import Actor, AIAgent, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import TestPlan, TestPlanTestSuite
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique_email(tag: str) -> str:
    return f"adr91-{tag}-{uuid4().hex[:8]}@example.com"


async def _create_user(session, email: str) -> User:
    user = User(name="ADR-91 Test User", email=email, password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str, name: str) -> Organization:
    org = Organization(name=name, slug=f"{slug_prefix}-{uuid4().hex[:8]}")
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization) -> None:
    session.add(
        OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=datetime.now(UTC))
    )
    await session.flush()


async def _grant_org_admin(session, user: User, org: Organization) -> None:
    """Org-wide `org_admin` `RoleAssignment` for the human `user` — the
    `AIAgent` acting on their behalf then inherits it via ADR-0083's
    bootstrap-fallback (the agent itself holds no `RoleAssignment` of its
    own anywhere in this org)."""
    role_id = await session.scalar(select(Role.id).where(Role.name == "org_admin", Role.org_id.is_(None)))
    session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, role_id=role_id, project_id=None))
    await session.flush()


async def _create_agent(session, *, acting_on_behalf_of_user_id) -> tuple[AIAgent, str]:
    raw_key, key_prefix = generate_api_key()
    agent = AIAgent(
        agent_name="ADR-91 Test Agent",
        model_or_provider="test-provider/test-model",
        acting_on_behalf_of_user_id=acting_on_behalf_of_user_id,
        key_hash=hash_api_key(raw_key),
        key_prefix=key_prefix,
        issued_at=datetime.now(UTC),
    )
    session.add(agent)
    await session.flush()
    return agent, raw_key


async def _create_project(session, org: Organization, name: str) -> Project:
    project = Project(org_id=org.id, name=name)
    session.add(project)
    await session.flush()
    return project


async def _cleanup(*, user_ids=None, agent_ids=None, org_ids=None, project_ids=None, extra_deletes=None) -> None:
    user_ids, agent_ids, org_ids, project_ids = user_ids or [], agent_ids or [], org_ids or [], project_ids or []
    async with AsyncSessionLocal() as session:
        for stmt in extra_deletes or []:
            await session.execute(stmt)
        # `create_project` auto-grants the caller (the AIAgent itself, when
        # it's the one calling) a project-scoped `RoleAssignment` (ADR-0017)
        # — must go before either Actor delete below, not just the user's own.
        if agent_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(agent_ids)))
        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if agent_ids:
            await session.execute(delete(AIAgent).where(AIAgent.actor_id.in_(agent_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(agent_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if user_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


@pytest.mark.asyncio
async def test_agent_can_create_a_project_previously_404d() -> None:
    """`POST /orgs/{org_id}/projects` as an `AIAgent` — was `404 not_found`
    ("Organization not found") for any agent, regardless of its
    `acting_on_behalf_of_user_id`'s real active membership."""
    email = _unique_email("proj")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []
    project_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)
            org = await _create_org(session, "adr91-proj", "ADR-91 Project Org")
            org_ids.append(org.id)
            await _create_membership(session, user, org)
            await _grant_org_admin(session, user, org)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)
            await session.commit()
            org_id = str(org.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                f"{API_PREFIX}/orgs/{org_id}/projects",
                json={"name": f"ADR-91 Project {uuid4().hex[:6]}"},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
        assert response.status_code == 201, response.text
        project_ids.append(response.json()["id"])
    finally:
        await _cleanup(user_ids=user_ids, agent_ids=agent_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_agent_can_add_a_test_case_to_a_suite_previously_404d() -> None:
    """`POST /test-suites/{id}/test-cases` (`tn_test_suite_test_case_create`)
    as an `AIAgent` — was `404 not_found` ("Test suite not found") against a
    real, existing suite the same agent could successfully `GET`."""
    email = _unique_email("suite")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []
    project_ids: list = []
    suite_ids: list = []
    case_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)
            org = await _create_org(session, "adr91-suite", "ADR-91 Suite Org")
            org_ids.append(org.id)
            await _create_membership(session, user, org)
            await _grant_org_admin(session, user, org)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)
            project = await _create_project(session, org, "ADR-91 Suite Project")
            project_ids.append(project.id)

            from app.models.taxonomy import TestLevel, TestType

            level = (await session.execute(TestLevel.__table__.select().limit(1))).first()
            type_ = (await session.execute(TestType.__table__.select().limit(1))).first()
            test_case = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                title="ADR-91 fixture case",
                created_by_actor_id=user.actor_id,
            )
            session.add(test_case)
            suite = TestSuite(project_id=project.id, name="ADR-91 fixture suite")
            session.add(suite)
            await session.flush()
            case_ids.append(test_case.id)
            suite_ids.append(suite.id)
            await session.commit()
            suite_id, case_id = str(suite.id), str(test_case.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                f"{API_PREFIX}/test-suites/{suite_id}/test-cases/{case_id}",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
        assert response.status_code == 201, response.text
    finally:
        await _cleanup(
            user_ids=user_ids,
            agent_ids=agent_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            extra_deletes=[
                delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)),
                delete(TestSuite).where(TestSuite.id.in_(suite_ids)),
                delete(TestCase).where(TestCase.id.in_(case_ids)),
            ],
        )


@pytest.mark.asyncio
async def test_agent_can_include_a_suite_in_a_plan_previously_404d() -> None:
    """`POST /test-plans/{id}/test-suites` (`tn_test_plan_test_suite_create`)
    as an `AIAgent` — same class of previously-broken gate as the suite
    membership route above, different bespoke module."""
    email = _unique_email("plan")
    user_ids: list = []
    agent_ids: list = []
    org_ids: list = []
    project_ids: list = []
    suite_ids: list = []
    plan_ids: list = []

    try:
        async with AsyncSessionLocal() as session:
            user = await _create_user(session, email)
            user_ids.append(user.actor_id)
            org = await _create_org(session, "adr91-plan", "ADR-91 Plan Org")
            org_ids.append(org.id)
            await _create_membership(session, user, org)
            await _grant_org_admin(session, user, org)
            agent, raw_key = await _create_agent(session, acting_on_behalf_of_user_id=user.actor_id)
            agent_ids.append(agent.actor_id)
            project = await _create_project(session, org, "ADR-91 Plan Project")
            project_ids.append(project.id)

            suite = TestSuite(project_id=project.id, name="ADR-91 fixture suite 2")
            plan = TestPlan(
                project_id=project.id,
                identifier=f"ADR-91-{uuid4().hex[:6]}",
                status="draft",
                created_by_actor_id=user.actor_id,
            )
            session.add_all([suite, plan])
            await session.flush()
            suite_ids.append(suite.id)
            plan_ids.append(plan.id)
            await session.commit()
            plan_id, suite_id = str(plan.id), str(suite.id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=10.0) as client:
            response = await client.post(
                f"{API_PREFIX}/test-plans/{plan_id}/test-suites/{suite_id}",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
        assert response.status_code == 201, response.text
    finally:
        await _cleanup(
            user_ids=user_ids,
            agent_ids=agent_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            extra_deletes=[
                delete(TestPlanTestSuite).where(TestPlanTestSuite.test_plan_id.in_(plan_ids)),
                delete(TestPlan).where(TestPlan.id.in_(plan_ids)),
                delete(TestSuite).where(TestSuite.id.in_(suite_ids)),
            ],
        )
