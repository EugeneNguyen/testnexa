"""Integration tests for the generic CRUD router factory (ADR-0021).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_projects.py`/`test_releases.py`'s
established style. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically
to this module too.

Covers TC-ADMIN-006 through TC-ADMIN-013 from
`docs/test-cases/2026-09-03-test-cases.md` — the factory-specific classes
Test Design §18 adds on top of TC-ADMIN-003/004/005's generic field-type/
permission-parity coverage (those three are frontend-level, `entityConfigs`-
driven, not this file's concern). One representative entity per resolver
depth (direct/one-hop/branching/multi-hop/global-catalog), per ADR-0021's
own framing that a pass on one depth doesn't generalize to another.

Each test seeds its own `User`/`Organization`/`OrgMembership`/
`RoleAssignment`/domain rows directly via `AsyncSessionLocal` — same
fixture-seeding precedent `test_projects.py` established — and cleans up in
a `finally` block. Emails/org slugs/lookup-table names are unique per test.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import Requirement, TestCase, TestCondition, TestStep
from app.models.auth import AuthIdentity, AuthProvider
from app.models.governance import RiskItem
from app.models.planning import TestPlan
from app.models.project import Project
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel, TestType
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"


# --- seeding / cleanup helpers ---------------------------------------------------------------
# Mirrors test_projects.py's helpers of the same names/shapes.


def _unique_email(tag: str) -> str:
    return f"admin2-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"admin2-{tag}-{uuid4().hex[:8]}"


def _unique_name(tag: str) -> str:
    return f"ADMIN-2 {tag} {uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="ADMIN-2 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"ADMIN-2 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization, status: OrgMembershipStatus) -> OrgMembership:
    membership = OrgMembership(
        org_id=org.id,
        user_id=user.actor_id,
        status=status,
        joined_at=datetime.now(UTC) if status != OrgMembershipStatus.invited else None,
    )
    session.add(membership)
    await session.flush()
    return membership


async def _get_role_by_name(session, name: str) -> Role:
    result = await session.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, f"expected the RBAC-4-seeded {name!r} system Role to already exist"
    return role


async def _assign_role(session, *, actor_id, org: Organization, role: Role, project_id=None) -> RoleAssignment:
    row = RoleAssignment(actor_id=actor_id, org_id=org.id, project_id=project_id, role_id=role.id)
    session.add(row)
    await session.flush()
    return row


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    """Seed a human org_admin User (org-wide RoleAssignment) of a fresh Organization."""
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    await _assign_role(session, actor_id=user.actor_id, org=org, role=org_admin_role)
    return user, org


async def _create_member_with_role(session, tag: str, org: Organization, role_name: str) -> User:
    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, OrgMembershipStatus.active)
    role = await _get_role_by_name(session, role_name)
    await _assign_role(session, actor_id=user.actor_id, org=org, role=role)
    return user


async def _create_project(session, org: Organization, tag: str) -> Project:
    project = Project(org_id=org.id, name=_unique_name(f"project-{tag}"))
    session.add(project)
    await session.flush()
    return project


async def _create_requirement(session, project: Project, tag: str) -> Requirement:
    req = Requirement(project_id=project.id, description=f"ADMIN-2 requirement {tag}")
    session.add(req)
    await session.flush()
    return req


async def _create_test_condition(session, requirement: Requirement, tag: str) -> TestCondition:
    cond = TestCondition(requirement_id=requirement.id, description=f"ADMIN-2 condition {tag}", priority="medium")
    session.add(cond)
    await session.flush()
    return cond


async def _create_taxonomy_pair(session, tag: str) -> tuple[TestLevel, TestType]:
    level = TestLevel(name=_unique_name(f"level-{tag}"))
    type_ = TestType(name=_unique_name(f"type-{tag}"))
    session.add_all([level, type_])
    await session.flush()
    return level, type_


async def _create_test_case(
    session, *, test_condition, test_level: TestLevel, test_type: TestType, created_by, tag: str
) -> TestCase:
    case = TestCase(
        test_condition_id=test_condition.id if test_condition is not None else None,
        test_level_id=test_level.id,
        test_type_id=test_type.id,
        created_by_actor_id=created_by,
        title=f"ADMIN-2 test case {tag}",
    )
    session.add(case)
    await session.flush()
    return case


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(
    *,
    user_ids: list | None = None,
    org_ids: list | None = None,
    project_ids: list | None = None,
    requirement_ids: list | None = None,
    test_condition_ids: list | None = None,
    test_case_ids: list | None = None,
    test_step_ids: list | None = None,
    risk_item_ids: list | None = None,
    test_plan_ids: list | None = None,
    test_level_ids: list | None = None,
    test_type_ids: list | None = None,
    role_ids: list | None = None,
) -> None:
    """Delete everything a test may have created, in FK-safe (child-first) order."""
    user_ids = list(user_ids or [])
    org_ids = org_ids or []
    project_ids = project_ids or []
    requirement_ids = requirement_ids or []
    test_condition_ids = test_condition_ids or []
    test_case_ids = test_case_ids or []
    test_step_ids = test_step_ids or []
    risk_item_ids = risk_item_ids or []
    test_plan_ids = test_plan_ids or []
    test_level_ids = test_level_ids or []
    test_type_ids = test_type_ids or []
    role_ids = role_ids or []

    async with AsyncSessionLocal() as session:
        if user_ids:
            result = await session.execute(select(User.actor_id).where(User.actor_id.in_(user_ids)))
            # no-op existence check, kept for symmetry with test_projects.py's shape
            list(result.all())

        if test_step_ids:
            await session.execute(delete(TestStep).where(TestStep.id.in_(test_step_ids)))
        if risk_item_ids:
            await session.execute(delete(RiskItem).where(RiskItem.id.in_(risk_item_ids)))
        if test_case_ids:
            await session.execute(delete(TestCase).where(TestCase.id.in_(test_case_ids)))
        if test_condition_ids:
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(test_condition_ids)))
        if requirement_ids:
            await session.execute(delete(Requirement).where(Requirement.id.in_(requirement_ids)))
        if test_plan_ids:
            await session.execute(delete(TestPlan).where(TestPlan.id.in_(test_plan_ids)))
        if test_level_ids:
            await session.execute(delete(TestLevel).where(TestLevel.id.in_(test_level_ids)))
        if test_type_ids:
            await session.execute(delete(TestType).where(TestType.id.in_(test_type_ids)))
        if project_ids:
            await session.execute(delete(Project).where(Project.id.in_(project_ids)))
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.org_id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(OrgMembership).where(OrgMembership.org_id.in_(org_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        if user_ids:
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        await session.commit()


# --- TC-ADMIN-006: cross-org 404 across resolver depths ---------------------------------------


@pytest.mark.asyncio
async def test_cross_org_404_direct_scope_requirement() -> None:  # TC-ADMIN-006a
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "006a-a")
            admin_b, org_b = await _create_org_admin(session, "006a-b")
            project_a = await _create_project(session, org_a, "006a")
            requirement = await _create_requirement(session, project_a, "006a")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id]
            requirement_ids = [requirement.id]
            token_b = _access_token_for(admin_b.actor_id)
            req_id = requirement.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/requirements/{req_id}", headers={"Authorization": f"Bearer {token_b}"}
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)


@pytest.mark.asyncio
async def test_cross_org_404_one_hop_test_condition() -> None:  # TC-ADMIN-006b
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "006b-a")
            admin_b, org_b = await _create_org_admin(session, "006b-b")
            project_a = await _create_project(session, org_a, "006b")
            requirement = await _create_requirement(session, project_a, "006b")
            condition = await _create_test_condition(session, requirement, "006b")
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            token_b = _access_token_for(admin_b.actor_id)
            cond_id = condition.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/test-conditions/{cond_id}", headers={"Authorization": f"Bearer {token_b}"}
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
        )


@pytest.mark.asyncio
async def test_cross_org_404_branching_risk_item() -> None:  # TC-ADMIN-006c
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    risk_item_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "006c-a")
            admin_b, org_b = await _create_org_admin(session, "006c-b")
            project_a = await _create_project(session, org_a, "006c")
            requirement = await _create_requirement(session, project_a, "006c")
            risk = RiskItem(
                requirement_id=requirement.id, description="ADMIN-2 risk", likelihood="low", impact="low"
            )
            session.add(risk)
            await session.flush()
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id]
            requirement_ids = [requirement.id]
            risk_item_ids = [risk.id]
            token_b = _access_token_for(admin_b.actor_id)
            risk_id = risk.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/risk-items/{risk_id}", headers={"Authorization": f"Bearer {token_b}"}
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            risk_item_ids=risk_item_ids,
        )


@pytest.mark.asyncio
async def test_cross_org_404_multi_hop_test_case() -> None:  # TC-ADMIN-006d
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "006d-a")
            admin_b, org_b = await _create_org_admin(session, "006d-b")
            project_a = await _create_project(session, org_a, "006d")
            requirement = await _create_requirement(session, project_a, "006d")
            condition = await _create_test_condition(session, requirement, "006d")
            level, type_ = await _create_taxonomy_pair(session, "006d")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin_a.actor_id,
                tag="006d",
            )
            await session.commit()
            user_ids = [admin_a.actor_id, admin_b.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token_b = _access_token_for(admin_b.actor_id)
            case_id = case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/test-cases/{case_id}", headers={"Authorization": f"Bearer {token_b}"}
            )

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-007: orphaned TestCase is unreachable (404), not any-org-fallback-readable -------


@pytest.mark.asyncio
async def test_orphaned_test_case_returns_404() -> None:  # TC-ADMIN-007
    user_ids: list = []
    org_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "007")
            level, type_ = await _create_taxonomy_pair(session, "007")
            # test_condition_id=None, and no TestSuiteTestCase link at all -> unresolvable.
            orphan = await _create_test_case(
                session, test_condition=None, test_level=level, test_type=type_, created_by=admin.actor_id, tag="007"
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            test_case_ids = [orphan.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token = _access_token_for(admin.actor_id)
            orphan_id = orphan.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            get_response = await client.get(
                f"{API_PREFIX}/test-cases/{orphan_id}", headers={"Authorization": f"Bearer {token}"}
            )
            patch_response = await client.patch(
                f"{API_PREFIX}/test-cases/{orphan_id}",
                json={"title": "Should never apply"},
                headers={"Authorization": f"Bearer {token}"},
            )
            delete_response = await client.delete(
                f"{API_PREFIX}/test-cases/{orphan_id}", headers={"Authorization": f"Bearer {token}"}
            )

        for response in (get_response, patch_response, delete_response):
            assert response.status_code == 404
            assert response.json()["code"] == "not_found"
    finally:
        await _cleanup(
            user_ids=user_ids, org_ids=org_ids, test_case_ids=test_case_ids,
            test_level_ids=test_level_ids, test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-008: global-catalog routes gate via has_permission_in_any_org --------------------


@pytest.mark.asyncio
async def test_global_catalog_create_gated_by_any_org_permission() -> None:  # TC-ADMIN-008
    user_ids: list = []
    org_ids: list = []
    test_level_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            # org_admin's bundle is "every permission", including test_level.create,
            # regardless of which org the grant lives in (no target org_id at all
            # in this request) -> proves the has_permission_in_any_org gate, not
            # the OrgMembership 404-vs-403 boundary every tenant-scoped entity uses.
            admin, org = await _create_org_admin(session, "008-admin")
            # `tester` bundle has no test_level.* at all (rbac_seed_catalog.py).
            tester = await _create_member_with_role(session, "008-tester", org, "tester")
            await session.commit()
            user_ids = [admin.actor_id, tester.actor_id]
            org_ids = [org.id]
            admin_token = _access_token_for(admin.actor_id)
            tester_token = _access_token_for(tester.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            allowed_response = await client.post(
                f"{API_PREFIX}/test-levels",
                json={"name": _unique_name("level-008")},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert allowed_response.status_code == 201
            test_level_ids = [allowed_response.json()["id"]]

            denied_response = await client.post(
                f"{API_PREFIX}/test-levels",
                json={"name": _unique_name("level-008-denied")},
                headers={"Authorization": f"Bearer {tester_token}"},
            )
            # Permission-denied, never 404 -- there's no tenant existence to hide
            # for a global catalog (ADR-0021).
            assert denied_response.status_code == 403
            assert denied_response.json()["code"] == "permission_denied"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, test_level_ids=test_level_ids)


# --- TC-ADMIN-009: Role org_id-null read/write split --------------------------------------------


@pytest.mark.asyncio
async def test_role_null_org_id_read_write_split() -> None:  # TC-ADMIN-009
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "009")
            tester_role = await _get_role_by_name(session, "tester")  # org_id IS NULL, system template
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)
            tester_role_id = tester_role.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            get_response = await client.get(
                f"{API_PREFIX}/roles/{tester_role_id}", headers={"Authorization": f"Bearer {token}"}
            )
            patch_response = await client.patch(
                f"{API_PREFIX}/roles/{tester_role_id}",
                json={"name": "Should never apply"},
                headers={"Authorization": f"Bearer {token}"},
            )
            delete_response = await client.delete(
                f"{API_PREFIX}/roles/{tester_role_id}", headers={"Authorization": f"Bearer {token}"}
            )

        assert get_response.status_code == 200
        assert get_response.json()["id"] == str(tester_role_id)

        assert patch_response.status_code == 404
        assert patch_response.json()["code"] == "not_found"

        assert delete_response.status_code == 404
        assert delete_response.json()["code"] == "not_found"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-ADMIN-010: scope field required on list/create, else 422 -------------------------------


@pytest.mark.asyncio
async def test_scope_required_on_list_and_create_returns_422() -> None:  # TC-ADMIN-010
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "010")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            list_response = await client.get(
                f"{API_PREFIX}/requirements", headers={"Authorization": f"Bearer {token}"}
            )
            create_response = await client.post(
                f"{API_PREFIX}/requirements",
                json={"description": "Should never be created, no project_id"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert list_response.status_code == 422
        assert list_response.json()["code"] == "validation_error"

        assert create_response.status_code == 422
        # Enforced by Pydantic's own required-field validation (`project_id`
        # has no default in `CreateRequirementRequest`), flattened by the
        # global RequestValidationError handler -> same {code,message,
        # field_errors} shape as the list-side scope check, different
        # enforcement layer (ADR-0021's plan doesn't mandate one specific
        # layer, only the 422 outcome).
        assert create_response.json()["code"] == "validation_error"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-ADMIN-011: RESTRICT-blocked delete -> 409, distinct from 422 ---------------------------


@pytest.mark.asyncio
async def test_restrict_delete_returns_409() -> None:  # TC-ADMIN-011
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "011")
            project = await _create_project(session, org, "011")
            requirement = await _create_requirement(session, project, "011")
            condition = await _create_test_condition(session, requirement, "011")
            level, type_ = await _create_taxonomy_pair(session, "011")
            # TestCase.test_condition_id FK is ondelete=RESTRICT -> deleting
            # the TestCondition while this TestCase still references it must
            # 409, not 422/500.
            case = await _create_test_case(
                session, test_condition=condition, test_level=level, test_type=type_,
                created_by=admin.actor_id, tag="011",
            )
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token = _access_token_for(admin.actor_id)
            condition_id = condition.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            blocked_response = await client.delete(
                f"{API_PREFIX}/test-conditions/{condition_id}", headers={"Authorization": f"Bearer {token}"}
            )
            assert blocked_response.status_code == 409
            assert blocked_response.json()["code"] == "restrict_blocked"

            # Unblock, then the same delete succeeds -- proves 409 isn't firing
            # unconditionally.
            delete_case_response = await client.delete(
                f"{API_PREFIX}/test-cases/{case.id}", headers={"Authorization": f"Bearer {token}"}
            )
            assert delete_case_response.status_code == 204
            test_case_ids = []  # already gone, don't double-delete in cleanup

            unblocked_response = await client.delete(
                f"{API_PREFIX}/test-conditions/{condition_id}", headers={"Authorization": f"Bearer {token}"}
            )
            assert unblocked_response.status_code == 204
            test_condition_ids = []  # already gone
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-012: RiskItem both-FKs-set -> 422 -------------------------------------------------


@pytest.mark.asyncio
async def test_risk_item_both_scope_fields_set_returns_422() -> None:  # TC-ADMIN-012
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_plan_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "012")
            project = await _create_project(session, org, "012")
            requirement = await _create_requirement(session, project, "012")
            plan = TestPlan(
                project_id=project.id, created_by_actor_id=admin.actor_id, identifier="ADMIN-2 TC-012 Plan"
            )
            session.add(plan)
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_plan_ids = [plan.id]
            token = _access_token_for(admin.actor_id)
            req_id, plan_id = requirement.id, plan.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            both_set_response = await client.post(
                f"{API_PREFIX}/risk-items",
                json={
                    "requirement_id": str(req_id),
                    "test_plan_id": str(plan_id),
                    "description": "Should never be created",
                    "likelihood": "low",
                    "impact": "low",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            neither_set_response = await client.post(
                f"{API_PREFIX}/risk-items",
                json={"description": "Should never be created either", "likelihood": "low", "impact": "low"},
                headers={"Authorization": f"Bearer {token}"},
            )

        assert both_set_response.status_code == 422
        assert both_set_response.json()["code"] == "validation_error"

        assert neither_set_response.status_code == 422
        assert neither_set_response.json()["code"] == "validation_error"
    finally:
        await _cleanup(
            user_ids=user_ids, org_ids=org_ids, project_ids=project_ids,
            requirement_ids=requirement_ids, test_plan_ids=test_plan_ids,
        )


# --- TC-ADMIN-013: free-text search is opt-in per entity ----------------------------------------


@pytest.mark.asyncio
async def test_search_matches_configured_fields_only() -> None:  # TC-ADMIN-013
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "013")
            project = await _create_project(session, org, "013")
            needle = f"UNIQUE-NEEDLE-{uuid4().hex[:8]}"
            matching = Requirement(project_id=project.id, description=f"contains {needle} inside it")
            other = Requirement(project_id=project.id, description="does not contain the search term")
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [matching.id, other.id]
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            search_response = await client.get(
                f"{API_PREFIX}/requirements",
                params={"project_id": str(proj_id), "q": needle},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert search_response.status_code == 200
            body = search_response.json()
            assert body["total"] == 1
            assert body["items"][0]["id"] == str(matching.id)
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, requirement_ids=requirement_ids)
