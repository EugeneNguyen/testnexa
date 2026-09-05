"""Integration tests for `GET /orgs/{org_id}/roles` (RBAC-3 UI slice —
role-assignment dropdown data source).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), same style as `test_role_assignments.py`, whose
seeding/cleanup helpers this module reuses verbatim (`_create_org_admin`,
`_create_member_with_role`, `_unique_email`, `_cleanup`, etc.) rather than
duplicating them.
"""

import os

import httpx
import pytest

from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.rbac import Role
from tests.integration.test_role_assignments import (
    _cleanup,
    _create_member_with_role,
    _create_org_admin,
    _create_user,
    _unique_email,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"


def _roles_path(org_id) -> str:
    return f"{API_PREFIX}/orgs/{org_id}/roles"


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


# --- happy path: system roles + this org's own custom role, no cross-org leak -----------------


@pytest.mark.asyncio
async def test_list_roles_returns_system_roles_and_this_orgs_custom_role() -> None:
    user_ids: list = []
    org_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "roles-happy")
            _other_admin, other_org = await _create_org_admin(session, "roles-happy-other")
            custom_role = Role(org_id=org.id, name="QA Lead", is_system_role=False)
            session.add(custom_role)
            await session.flush()
            foreign_custom_role = Role(org_id=other_org.id, name="Foreign Lead", is_system_role=False)
            session.add(foreign_custom_role)
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id, _other_admin.actor_id]
            org_ids = [org.id, other_org.id]
            role_ids = [custom_role.id, foreign_custom_role.id]
            admin_id, org_id, custom_role_id, foreign_role_id = (
                admin.actor_id,
                org.id,
                custom_role.id,
                foreign_custom_role.id,
            )

        access_token = _access_token_for(admin_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _roles_path(org_id), headers={"Authorization": f"Bearer {access_token}"}
            )

        assert response.status_code == 200
        body = response.json()
        names = {row["name"] for row in body}
        ids = {row["id"] for row in body}

        # RBAC-4's 5 seeded system roles are always present.
        assert {"org_admin", "test_manager", "tester", "auditor", "ai_agent_scoped"} <= names
        # This org's own custom role is included...
        assert str(custom_role_id) in ids
        # ...but a different org's custom role never leaks in.
        assert str(foreign_role_id) not in ids

        system_rows = [row for row in body if row["is_system_role"]]
        assert len(system_rows) == 5
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, role_ids=role_ids)


# --- 404-vs-403 boundary, same pattern as every other org-scoped route ------------------------


@pytest.mark.asyncio
async def test_list_roles_404_for_zero_membership_actor() -> None:
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            outsider = await _create_user(session, _unique_email("roles-404"))
            _admin, org = await _create_org_admin(session, "roles-404-org")
            await session.commit()
            user_ids = [outsider.actor_id, _admin.actor_id]
            org_ids = [org.id]
            outsider_id, org_id = outsider.actor_id, org.id

        access_token = _access_token_for(outsider_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _roles_path(org_id), headers={"Authorization": f"Bearer {access_token}"}
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


@pytest.mark.asyncio
async def test_list_roles_403_for_member_lacking_role_read_permission() -> None:
    """`ai_agent_scoped`'s seeded bundle has no `role.*` codes at all
    (Database Document §3.3) — a human member holding only that role is a
    real "member but lacking `role.read`" case, same posture
    `test_role_assignments.py`'s own 403 boundary tests use."""
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            _admin, org = await _create_org_admin(session, "roles-403b")
            member = await _create_member_with_role(session, "roles-403b-member", org, "ai_agent_scoped")
            await session.commit()
            user_ids = [_admin.actor_id, member.actor_id]
            org_ids = [org.id]
            member_id, org_id = member.actor_id, org.id

        access_token = _access_token_for(member_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                _roles_path(org_id), headers={"Authorization": f"Bearer {access_token}"}
            )

        assert response.status_code == 403
        assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)
