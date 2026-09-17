"""Integration tests for ADR-0084: `TestCycle` gains a denormalized
`project_id` and a branching `scope_field` (`test_plan_id` | `project_id`).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching this repo's established per-file
fixture-ownership convention (seeding helpers duplicated in shape from
`test_plan3_test_cycle_execution.py`, not cross-imported).

Covers: the bespoke create route (`test_cycle_creation.py`) backfills
`project_id` from `TestPlan.project_id`; the new flat
`GET /test-cycles?project_id=...` list works and returns the same row the
pre-existing `?test_plan_id=...` list already did (regression guard); and
`extract_scope_value`'s "exactly one" rule now applies to this entity too
(neither/both scope params -> `422`).
"""

import os
import uuid
from datetime import UTC, date, datetime

import httpx
import pytest

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider
from app.models.planning import Environment, TestCycle, TestPlan
from app.models.project import Project, Release
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from sqlalchemy import delete, select

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


def _unique(tag: str) -> str:
    return f"adr84-{tag}-{uuid.uuid4().hex[:8]}"


def _unique_email(tag: str) -> str:
    return f"{_unique(tag)}@example.com"


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    user = User(name="ADR-0084 Test User", email=_unique_email(tag), password_hash=hash_password(DEFAULT_PASSWORD))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

    org = Organization(name=f"ADR-0084 Org {tag}", slug=_unique(f"org-{tag}"))
    session.add(org)
    await session.flush()

    session.add(OrgMembership(org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=datetime.now(UTC)))

    result = await session.execute(select(Role).where(Role.name == "org_admin", Role.org_id.is_(None)))
    org_admin_role = result.scalars().first()
    assert org_admin_role is not None, "system role 'org_admin' must already be seeded (RBAC-4)"
    session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))
    await session.flush()
    return user, org


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique(f"project-{tag}"))
    session.add(project)
    await session.flush()
    return project


async def _create_test_plan(session, project: Project, actor_id, tag: str) -> TestPlan:
    plan = TestPlan(project_id=project.id, created_by_actor_id=actor_id, identifier=_unique(f"plan-{tag}"), scope="ADR-0084 fixture")
    session.add(plan)
    await session.flush()
    return plan


async def _create_release(session, project: Project, tag: str) -> Release:
    release = Release(project_id=project.id, version_label=_unique(f"release-{tag}"), target_date=date(2026, 12, 31))
    session.add(release)
    await session.flush()
    return release


async def _create_environment(session, project: Project, tag: str) -> Environment:
    environment = Environment(project_id=project.id, name=_unique(f"env-{tag}"))
    session.add(environment)
    await session.flush()
    return environment


async def _access_token_for(actor_id) -> str:
    from app.core.security import create_access_token

    return create_access_token(str(actor_id))


async def _cleanup(*, user_ids=(), org_ids=(), project_ids=(), test_cycle_ids=()) -> None:
    async with AsyncSessionLocal() as session:
        for cid in test_cycle_ids:
            await session.execute(delete(TestCycle).where(TestCycle.id == cid))
        for uid in user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id == uid))
        # TestPlan/Release/Environment cascade with the Project below via
        # their own FK ondelete behavior is RESTRICT in this schema, so the
        # rows this fixture creates must go before the Project — deleting
        # by project_id catches every child in one statement each, same
        # posture the other test files in this package already use.
        from app.models.planning import TestPlan as _TestPlan

        for pid in project_ids:
            await session.execute(delete(TestCycle).where(TestCycle.project_id == pid))
            await session.execute(delete(Environment).where(Environment.project_id == pid))
            await session.execute(delete(Release).where(Release.project_id == pid))
            await session.execute(delete(_TestPlan).where(_TestPlan.project_id == pid))
        for oid in org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id == oid))
        for pid in project_ids:
            await session.execute(delete(Project).where(Project.id == pid))
        for oid in org_ids:
            await session.execute(delete(Organization).where(Organization.id == oid))
        for uid in user_ids:
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id == uid))
            await session.execute(delete(User).where(User.actor_id == uid))
        await session.commit()


@pytest.mark.asyncio
async def test_create_backfills_project_id_and_both_list_scopes_agree() -> None:
    user_ids, org_ids, project_ids, cycle_ids = [], [], [], []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "backfill")
            project = await _create_project(session, org, "backfill")
            plan = await _create_test_plan(session, project, user.actor_id, "backfill")
            release = await _create_release(session, project, "backfill")
            environment = await _create_environment(session, project, "backfill")
            await session.commit()

            user_ids, org_ids, project_ids = [user.actor_id], [org.id], [project.id]
            plan_id, project_id, release_id, environment_id = plan.id, project.id, release.id, environment.id

        token = await _access_token_for(user.actor_id)
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            create_resp = await client.post(
                f"{API_PREFIX}/test-plans/{plan_id}/test-cycles",
                json={"release_id": str(release_id), "environment_id": str(environment_id), "name": "ADR-0084 Cycle"},
                headers=headers,
            )
            assert create_resp.status_code == 201, create_resp.text
            body = create_resp.json()
            assert body["test_plan_id"] == str(plan_id)
            assert body["project_id"] == str(project_id), body
            cycle_id = body["id"]
            cycle_ids.append(cycle_id)

            by_plan = await client.get(f"{API_PREFIX}/test-cycles", params={"test_plan_id": str(plan_id)}, headers=headers)
            assert by_plan.status_code == 200, by_plan.text
            assert [item["id"] for item in by_plan.json()["items"]] == [cycle_id]

            by_project = await client.get(f"{API_PREFIX}/test-cycles", params={"project_id": str(project_id)}, headers=headers)
            assert by_project.status_code == 200, by_project.text
            assert [item["id"] for item in by_project.json()["items"]] == [cycle_id]

            get_resp = await client.get(f"{API_PREFIX}/test-cycles/{cycle_id}", headers=headers)
            assert get_resp.status_code == 200, get_resp.text
            assert get_resp.json()["project_id"] == str(project_id)
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, test_cycle_ids=cycle_ids)


@pytest.mark.asyncio
async def test_list_rejects_neither_or_both_scope_params() -> None:
    user_ids, org_ids, project_ids = [], [], []
    try:
        async with AsyncSessionLocal() as session:
            user, org = await _create_org_admin(session, "scope422")
            project = await _create_project(session, org, "scope422")
            plan = await _create_test_plan(session, project, user.actor_id, "scope422")
            await session.commit()
            user_ids, org_ids, project_ids = [user.actor_id], [org.id], [project.id]
            plan_id, project_id = plan.id, project.id

        token = await _access_token_for(user.actor_id)
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            neither = await client.get(f"{API_PREFIX}/test-cycles", headers=headers)
            assert neither.status_code == 422, neither.text
            assert neither.json()["code"] == "validation_error"

            both = await client.get(
                f"{API_PREFIX}/test-cycles",
                params={"test_plan_id": str(plan_id), "project_id": str(project_id)},
                headers=headers,
            )
            assert both.status_code == 422, both.text
            assert both.json()["code"] == "validation_error"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)
