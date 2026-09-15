"""ADR-0073 integration: the four bespoke traceability link-create routes.

Real HTTP via `httpx.AsyncClient` against `TEST_API_BASE_URL`, reusing
`test_admin2_crud.py`'s and `test_admin2_execution_trace.py`'s seeding helpers
rather than duplicating them.

Covers TC-ADMIN-067 (create-then-list round trip, all four routes),
TC-ADMIN-068 (cross-tenant `404`, all four routes), TC-ADMIN-069 (duplicate
`409` and cross-project `422`), TC-ADMIN-070 (permission `403`), and
TC-ADMIN-071 (the standalone-`TestCase` project-resolver defect ADR-0073 found
and fixed).

**Every positive test is a create-through-the-real-route, then fire the
relation's own scoped list request** — never a create-response assertion, and
never a direct ORM read-back. That is the exact discipline
`backend/CLAUDE.md`'s resolver-completeness note (ADR-0029) prescribes, and it
is load-bearing rather than ceremonial here: a bespoke create route that
inserts a row shape the entity's `resolve_org_id` has no branch for produces a
perfectly good `201` and then `404`s on the very next read. The new routes
write the same two-FK row shape the link tables already held, so the branches
*should* cover it — but "should" is exactly what this class of test exists to
stop anyone asserting from the config alone.

The list request is built from the **served relation** (`GET
/{relation.entity}?{relation.scopeField}=`), not from a literal path, so it is
byte-for-byte the request `EntityRelationTab.tsx` fires after its own "Link
existing ..." action succeeds. A route that creates a row the tab then cannot
see fails here rather than in a browser.

The cross-tenant tests are the security half (NFR-1/ADR-0007), one per route:
a far row in another organization must be `404`, indistinguishable from a
nonexistent one — never `403`, and never the cross-project `422`, which would
confirm the row exists.
"""

import uuid

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.rbac import Permission, Role, RoleAssignment, RolePermission
from tests.integration.test_admin2_crud import (
    API_PREFIX,
    TEST_API_BASE_URL,
    _access_token_for,
    _create_membership,
    _create_org,
    _create_org_admin,
    _create_project,
    _create_requirement,
    _create_taxonomy_pair,
    _create_test_case,
    _create_test_condition,
    _create_user,
    _unique_email,
    _unique_name,
)
from tests.integration.test_admin2_crud import _cleanup as _crud_cleanup
from tests.integration.test_admin2_execution_trace import (
    _cleanup_extra,
    _create_defect,
    _create_environment_row,
    _create_release,
    _create_test_cycle,
    _create_test_execution,
    _create_test_plan,
)

#: `(link entity route slug, this route's own two FK field names)` — the four
#: routes under test, keyed the way both the schema's `linkCreate.pathTemplate`
#: and the served relation's `scopeField`/`targetField` name them.
LINK_ENTITIES = {
    "requirement_test_case_link": "requirement-test-case-links",
    "requirement_test_condition_link": "requirement-test-condition-links",
    "test_condition_test_case_link": "test-condition-test-case-links",
    "test_case_defect_link": "test-case-defect-links",
}


async def _grant_custom_role(session, org, tag: str, codes: list[str]):
    """A non-`org_admin` member holding exactly `codes`, for the 403 tests.

    Seeds **both** an active `OrgMembership` and the `RoleAssignment` — a bare
    role assignment with no membership 404s at every gated route's NFR-1
    boundary and reads exactly like the route being broken
    (`backend/CLAUDE.md`'s `_assign_role`-is-not-enough note).
    """
    from sqlalchemy import select

    user = await _create_user(session, _unique_email(tag))
    await _create_membership(session, user, org, "active")
    role = Role(org_id=org.id, name=_unique_name(f"role-{tag}"), is_system_role=False)
    session.add(role)
    await session.flush()
    for code in codes:
        permission = (await session.execute(select(Permission).where(Permission.code == code))).scalars().first()
        assert permission is not None, f"{code} must be seeded — run `alembic upgrade head`"
        session.add(RolePermission(role_id=role.id, permission_id=permission.id))
    session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=role.id))
    await session.flush()
    return user, role


async def _cleanup_roles(role_ids: list) -> None:
    """Child-first: `role_assignment` and `role_permission` both FK `role.id`.

    The `RoleAssignment` delete is keyed on `role_id`, not on the actor —
    `test_admin2_crud._cleanup` deletes assignments by `actor_id` and runs
    *after* this helper, so relying on it leaves the grant row alive at the
    moment `DELETE FROM role` fires (`role_assignment_role_id_fkey`, hit
    directly on this file's first run).
    """
    async with AsyncSessionLocal() as session:
        if role_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.role_id.in_(role_ids)))
            await session.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
            await session.execute(delete(Role).where(Role.id.in_(role_ids)))
        await session.commit()


async def _link_and_read_back(
    client: httpx.AsyncClient,
    auth: dict,
    *,
    path: str,
    parent_entity: str,
    link_entity: str,
    scope_field: str,
    target_field: str,
    parent_id,
    far_id,
) -> str:
    """POST the link, then prove it through the relation's own list request.

    Returns the created link row's id (for cleanup). Four assertions, in the
    order that makes a failure diagnosable:

    1. the `POST` is a `201` carrying both ids — the route ran,
    2. the parent's schema advertises a relation for this link entity — the
       tab exists at all,
    3. that relation's own list request returns the new row — the resolver
       covers the shape the route just wrote (the ADR-0029 gap),
    4. the row carries the far id under `targetField` — the tab's row-click
       has something to navigate with.
    """
    created = await client.post(path, headers=auth)
    assert created.status_code == 201, f"{path} -> {created.status_code} {created.text}"
    body = created.json()
    assert body[scope_field] == str(parent_id), body
    assert body[target_field] == str(far_id), body

    schema = await client.get(f"{API_PREFIX}/entities/{parent_entity}/schema", headers=auth)
    assert schema.status_code == 200, schema.text
    relations = {relation["entity"]: relation for relation in schema.json()["relations"]}
    assert link_entity in relations, sorted(relations)
    relation = relations[link_entity]
    assert relation["scopeField"] == scope_field

    listed = await client.get(
        f"{API_PREFIX}/{relation['entity']}",
        params={relation["scopeField"]: str(parent_id)},
        headers=auth,
    )
    assert listed.status_code == 200, (
        f"the row {path} just created is unreadable through its own relation's list "
        f"request: {listed.status_code} {listed.text} — a resolver-completeness gap, "
        f"exactly what a create-only assertion would have missed"
    )
    payload = listed.json()
    rows = [row for row in payload["items"] if row[relation["targetField"]] == str(far_id)]
    assert len(rows) == 1, payload
    return rows[0]["id"]


# --- TC-ADMIN-067 / TC-ADMIN-068: requirement -> test case ---------------------------------


@pytest.mark.asyncio
async def test_link_existing_test_case_to_requirement_then_read_it_back() -> None:  # TC-ADMIN-067
    """`POST /requirements/{id}/test-case-links/{test_case_id}`.

    The `TestCase` is created standalone (REQ-5/ADR-0069's `project_id` shape)
    precisely because that is the shape a "Link existing test case" picker
    surfaces most often and the one whose project resolution ADR-0073 had to
    fix — see `test_a_standalone_test_case_can_be_linked_at_all` below for the
    same shape asserted as its own regression.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    link_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a73-rtc")
            project = await _create_project(session, org, "a73-rtc")
            requirement = await _create_requirement(session, project, "a73-rtc")
            level, type_ = await _create_taxonomy_pair(session, "a73-rtc")
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, project_id, level_id, type_id = requirement.id, project.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # A standalone case, through its own real generic create route.
            created = await client.post(
                f"{API_PREFIX}/test-cases",
                headers=auth,
                json={
                    "project_id": str(project_id),
                    "title": _unique_name("Case a73-rtc"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]

            row_id = await _link_and_read_back(
                client,
                auth,
                path=f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}",
                parent_entity="requirements",
                link_entity="requirement-test-case-links",
                scope_field="requirement_id",
                target_field="test_case_id",
                parent_id=requirement_id,
                far_id=case_id,
            )
            link_ids = {"requirement_test_case_link": [row_id]}

            # TC-ADMIN-069: the same pair again is a `409` on the pair's own
            # unique constraint, never a silent second row.
            again = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}", headers=auth
            )
            assert again.status_code == 409, again.text
            assert again.json()["code"] == "link_already_exists"
    finally:
        await _cleanup_extra(link_ids=link_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_linking_a_test_case_from_another_org_is_404_not_403() -> None:  # TC-ADMIN-068
    """NFR-1/ADR-0007: existence is never confirmable across a tenant boundary.

    The caller is a real `org_admin` of org A with every permission, so the
    only thing standing between them and the link is the far row's tenant — a
    `403` or a `422` here would both confirm the `TestCase` exists.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_case_ids: list = []
    test_condition_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org_a = await _create_org_admin(session, "a73-x1")
            project_a = await _create_project(session, org_a, "a73-x1")
            requirement_a = await _create_requirement(session, project_a, "a73-x1")

            # A completely separate tenant the caller has no membership in.
            other_admin, org_b = await _create_org_admin(session, "a73-x2")
            project_b = await _create_project(session, org_b, "a73-x2")
            requirement_b = await _create_requirement(session, project_b, "a73-x2")
            condition_b = await _create_test_condition(session, requirement_b, "a73-x2")
            level, type_ = await _create_taxonomy_pair(session, "a73-x")
            case_b = await _create_test_case(
                session,
                test_condition=condition_b,
                test_level=level,
                test_type=type_,
                created_by=other_admin.actor_id,
                tag="a73-x2",
            )
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_a.id, requirement_b.id]
            test_condition_ids = [condition_b.id]
            test_case_ids = [case_b.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_a_id, case_b_id = requirement_a.id, case_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_a_id}/test-case-links/{case_b_id}", headers=auth
            )
            assert response.status_code == 404, response.text
            assert response.json()["code"] == "not_found"

            # And the reverse: a parent the caller cannot see is equally 404,
            # checked *before* the far row is even looked at.
            reverse = await client.post(
                f"{API_PREFIX}/requirements/{requirement_ids[1]}/test-case-links/{uuid.uuid4()}", headers=auth
            )
            assert reverse.status_code == 404, reverse.text
    finally:
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-067 / 068: requirement -> test condition, and test condition -> test case ------


@pytest.mark.asyncio
async def test_link_test_condition_to_requirement_and_test_case_to_test_condition() -> None:  # TC-ADMIN-067
    """Two routes in one fixture, because REQ-3's own rigor path builds both
    entities in sequence — and because the pair is what proves the
    `" (linked)"` label disambiguation ADR-0071 §5 depends on is reachable:
    `Requirement` ends up with a "Test conditions" tab (the owning FK) *and* a
    "Test conditions (linked)" one (this link table), and both are now
    writable.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    link_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a73-cond")
            project = await _create_project(session, org, "a73-cond")
            # Two requirements: the condition is *owned* by one and linked to
            # the other, so the link is not a same-row self-reference.
            owner_requirement = await _create_requirement(session, project, "a73-owner")
            other_requirement = await _create_requirement(session, project, "a73-other")
            condition = await _create_test_condition(session, owner_requirement, "a73-cond")
            level, type_ = await _create_taxonomy_pair(session, "a73-cond")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a73-cond",
            )
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [owner_requirement.id, other_requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            other_requirement_id, condition_id, case_id = other_requirement.id, condition.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            condition_link_id = await _link_and_read_back(
                client,
                auth,
                path=f"{API_PREFIX}/requirements/{other_requirement_id}/test-condition-links/{condition_id}",
                parent_entity="requirements",
                link_entity="requirement-test-condition-links",
                scope_field="requirement_id",
                target_field="test_condition_id",
                parent_id=other_requirement_id,
                far_id=condition_id,
            )

            case_link_id = await _link_and_read_back(
                client,
                auth,
                path=f"{API_PREFIX}/test-conditions/{condition_id}/test-case-links/{case_id}",
                parent_entity="test-conditions",
                link_entity="test-condition-test-case-links",
                scope_field="test_condition_id",
                target_field="test_case_id",
                parent_id=condition_id,
                far_id=case_id,
            )

            link_ids = {
                "requirement_test_condition_link": [condition_link_id],
                "test_condition_test_case_link": [case_link_id],
            }
    finally:
        await _cleanup_extra(link_ids=link_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


@pytest.mark.asyncio
async def test_the_two_test_condition_routes_reject_a_cross_tenant_far_row() -> None:  # TC-ADMIN-068
    """One `404` assertion per route, both far rows sitting in another org."""
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
            admin, org_a = await _create_org_admin(session, "a73-y1")
            project_a = await _create_project(session, org_a, "a73-y1")
            requirement_a = await _create_requirement(session, project_a, "a73-y1")
            condition_a = await _create_test_condition(session, requirement_a, "a73-y1")

            other_admin, org_b = await _create_org_admin(session, "a73-y2")
            project_b = await _create_project(session, org_b, "a73-y2")
            requirement_b = await _create_requirement(session, project_b, "a73-y2")
            condition_b = await _create_test_condition(session, requirement_b, "a73-y2")
            level, type_ = await _create_taxonomy_pair(session, "a73-y")
            case_b = await _create_test_case(
                session,
                test_condition=condition_b,
                test_level=level,
                test_type=type_,
                created_by=other_admin.actor_id,
                tag="a73-y2",
            )
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_a.id, requirement_b.id]
            test_condition_ids = [condition_a.id, condition_b.id]
            test_case_ids = [case_b.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_a_id, condition_a_id = requirement_a.id, condition_a.id
            condition_b_id, case_b_id = condition_b.id, case_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            cross_condition = await client.post(
                f"{API_PREFIX}/requirements/{requirement_a_id}/test-condition-links/{condition_b_id}", headers=auth
            )
            assert cross_condition.status_code == 404, cross_condition.text
            assert cross_condition.json()["code"] == "not_found"

            cross_case = await client.post(
                f"{API_PREFIX}/test-conditions/{condition_a_id}/test-case-links/{case_b_id}", headers=auth
            )
            assert cross_case.status_code == 404, cross_case.text
            assert cross_case.json()["code"] == "not_found"
    finally:
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-067 / 068: test case -> defect -------------------------------------------------


@pytest.mark.asyncio
async def test_link_existing_defect_to_test_case_then_read_it_back() -> None:  # TC-ADMIN-067
    """`POST /test-cases/{id}/defect-links/{defect_id}`.

    The `Defect` is reached the only way one exists — through a
    `TestExecution` of a `TestCycle` of a `TestPlan` — so this exercises the
    four-hop project chain the route's cross-project check walks, not a
    one-hop shortcut.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    plan_ids: list = []
    cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    execution_ids: list = []
    defect_ids: list = []
    link_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a73-def")
            project = await _create_project(session, org, "a73-def")
            requirement = await _create_requirement(session, project, "a73-def")
            condition = await _create_test_condition(session, requirement, "a73-def")
            level, type_ = await _create_taxonomy_pair(session, "a73-def")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a73-def",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a73-def")
            release = await _create_release(session, project, "a73-def")
            environment = await _create_environment_row(session, project, "a73-def")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a73-def"
            )
            execution = await _create_test_execution(
                session, test_cycle=cycle, test_case=case, executed_by=admin.actor_id, tag="a73-def"
            )
            defect = await _create_defect(session, test_execution=execution, reported_by=admin.actor_id, tag="a73-def")
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            plan_ids, cycle_ids = [plan.id], [cycle.id]
            release_ids, environment_ids = [release.id], [environment.id]
            execution_ids, defect_ids = [execution.id], [defect.id]
            token = _access_token_for(admin.actor_id)
            case_id, defect_id = case.id, defect.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            row_id = await _link_and_read_back(
                client,
                auth,
                path=f"{API_PREFIX}/test-cases/{case_id}/defect-links/{defect_id}",
                parent_entity="test-cases",
                link_entity="test-case-defect-links",
                scope_field="test_case_id",
                target_field="defect_id",
                parent_id=case_id,
                far_id=defect_id,
            )
            link_ids = {"test_case_defect_link": [row_id]}
    finally:
        await _cleanup_extra(
            link_ids=link_ids,
            defect_ids=defect_ids,
            test_execution_ids=execution_ids,
            test_cycle_ids=cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_plan_ids=plan_ids,
        )


@pytest.mark.asyncio
async def test_linking_a_defect_from_another_org_is_404() -> None:  # TC-ADMIN-068
    """The fourth route's own tenant boundary, walked through the full
    `Defect -> TestExecution -> TestCycle -> TestPlan -> Project` chain."""
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    plan_ids: list = []
    cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    execution_ids: list = []
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org_a = await _create_org_admin(session, "a73-z1")
            project_a = await _create_project(session, org_a, "a73-z1")
            requirement_a = await _create_requirement(session, project_a, "a73-z1")
            condition_a = await _create_test_condition(session, requirement_a, "a73-z1")
            level, type_ = await _create_taxonomy_pair(session, "a73-z")
            case_a = await _create_test_case(
                session,
                test_condition=condition_a,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a73-z1",
            )

            other_admin, org_b = await _create_org_admin(session, "a73-z2")
            project_b = await _create_project(session, org_b, "a73-z2")
            requirement_b = await _create_requirement(session, project_b, "a73-z2")
            condition_b = await _create_test_condition(session, requirement_b, "a73-z2")
            case_b = await _create_test_case(
                session,
                test_condition=condition_b,
                test_level=level,
                test_type=type_,
                created_by=other_admin.actor_id,
                tag="a73-z2",
            )
            plan_b = await _create_test_plan(session, project_b, other_admin.actor_id, "a73-z2")
            release_b = await _create_release(session, project_b, "a73-z2")
            environment_b = await _create_environment_row(session, project_b, "a73-z2")
            cycle_b = await _create_test_cycle(
                session, test_plan=plan_b, release=release_b, environment=environment_b, tag="a73-z2"
            )
            execution_b = await _create_test_execution(
                session, test_cycle=cycle_b, test_case=case_b, executed_by=other_admin.actor_id, tag="a73-z2"
            )
            defect_b = await _create_defect(
                session, test_execution=execution_b, reported_by=other_admin.actor_id, tag="a73-z2"
            )
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_a.id, requirement_b.id]
            test_condition_ids = [condition_a.id, condition_b.id]
            test_case_ids = [case_a.id, case_b.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            plan_ids, cycle_ids = [plan_b.id], [cycle_b.id]
            release_ids, environment_ids = [release_b.id], [environment_b.id]
            execution_ids, defect_ids = [execution_b.id], [defect_b.id]
            token = _access_token_for(admin.actor_id)
            case_a_id, defect_b_id = case_a.id, defect_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            response = await client.post(
                f"{API_PREFIX}/test-cases/{case_a_id}/defect-links/{defect_b_id}", headers=auth
            )
            assert response.status_code == 404, response.text
            assert response.json()["code"] == "not_found"
    finally:
        await _cleanup_extra(
            defect_ids=defect_ids,
            test_execution_ids=execution_ids,
            test_cycle_ids=cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
            test_plan_ids=plan_ids,
        )


# --- TC-ADMIN-069: cross-project is 422, not 404 ---------------------------------------------


@pytest.mark.asyncio
async def test_same_org_but_cross_project_link_is_422_not_404() -> None:  # TC-ADMIN-069
    """The other side of the boundary, and why the distinction matters.

    Both projects live in the org the caller is a member of, so there is no
    existence left to hide (ADR-0030 §1's reasoning, reused verbatim) — the
    rejection is a business rule, and saying so is strictly more useful than a
    `404` that would read as "this test case does not exist."
    """
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
            admin, org = await _create_org_admin(session, "a73-xp")
            project_one = await _create_project(session, org, "a73-xp1")
            project_two = await _create_project(session, org, "a73-xp2")
            requirement_one = await _create_requirement(session, project_one, "a73-xp1")
            requirement_two = await _create_requirement(session, project_two, "a73-xp2")
            condition_two = await _create_test_condition(session, requirement_two, "a73-xp2")
            level, type_ = await _create_taxonomy_pair(session, "a73-xp")
            case_two = await _create_test_case(
                session,
                test_condition=condition_two,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a73-xp2",
            )
            await session.commit()

            user_ids, org_ids = [admin.actor_id], [org.id]
            project_ids = [project_one.id, project_two.id]
            requirement_ids = [requirement_one.id, requirement_two.id]
            test_condition_ids = [condition_two.id]
            test_case_ids = [case_two.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_one_id, condition_two_id, case_two_id = requirement_one.id, condition_two.id, case_two.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            case_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_one_id}/test-case-links/{case_two_id}", headers=auth
            )
            assert case_response.status_code == 422, case_response.text
            assert case_response.json()["code"] == "validation_error"
            assert case_response.json()["message"] == "This test case belongs to a different project."

            condition_response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_one_id}/test-condition-links/{condition_two_id}", headers=auth
            )
            assert condition_response.status_code == 422, condition_response.text
            assert condition_response.json()["message"] == "This test condition belongs to a different project."
    finally:
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-070: permission gating ---------------------------------------------------------


@pytest.mark.asyncio
async def test_a_member_without_the_link_create_code_gets_403_not_404() -> None:  # TC-ADMIN-070
    """403, not 404 — the caller is a member of the org and can already read
    the parent, so there is no existence to hide; the only thing missing is
    the grant. This is also the exact code `linkCreate.permission` advertises,
    so a `403` here would mean the UI's own pre-emptive gate and the route's
    real gate disagree.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a73-403")
            project = await _create_project(session, org, "a73-403")
            requirement = await _create_requirement(session, project, "a73-403")
            level, type_ = await _create_taxonomy_pair(session, "a73-403")
            condition = await _create_test_condition(session, requirement, "a73-403")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a73-403",
            )
            # Everything needed to *see* the requirement, nothing to link it.
            member, role = await _grant_custom_role(
                session, org, "a73-403", ["requirement.read", "requirement_test_case_link.read"]
            )
            await session.commit()

            user_ids = [admin.actor_id, member.actor_id]
            org_ids, project_ids = [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            role_ids = [role.id]
            token = _access_token_for(member.actor_id)
            requirement_id, case_id = requirement.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            response = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}", headers=auth
            )
            assert response.status_code == 403, response.text
            assert response.json()["code"] == "permission_denied"
    finally:
        await _cleanup_roles(role_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-071: the standalone-TestCase project-resolver defect ---------------------------


@pytest.mark.asyncio
async def test_a_standalone_test_case_can_be_added_to_a_suite_in_its_own_project() -> None:  # TC-ADMIN-071
    """Regression for the defect ADR-0073 found and fixed.

    `test_suite_membership.py` carried a private, three-branch copy of the
    `TestCase`-project walk, written before `TestCase` had a `project_id`
    column at all. REQ-5/ADR-0069 added the column and a fourth branch to the
    *org* resolver, and nothing pointed at the project-side copy — so
    `add_test_case_to_suite` resolved `None` for every standalone case and
    rejected it with `422 "This test case belongs to a different project."`
    even when the suite and the case sat in the same project.

    Asserted against REQ-4's **own** route rather than any of ADR-0073's new
    ones, because that is the route that was broken; a test against a new
    route would pass on a codebase where the defect is still live. The
    equivalent standalone path through a new route is covered by
    `test_link_existing_test_case_to_requirement_then_read_it_back` above,
    which deliberately seeds its case the same way.
    """
    from sqlalchemy import delete as sa_delete

    from app.models.assets import TestSuite, TestSuiteTestCase

    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    suite_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a73-solo")
            project = await _create_project(session, org, "a73-solo")
            level, type_ = await _create_taxonomy_pair(session, "a73-solo")
            suite = TestSuite(project_id=project.id, name=_unique_name("suite-a73-solo"))
            session.add(suite)
            await session.flush()
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            suite_ids = [suite.id]
            token = _access_token_for(admin.actor_id)
            project_id, suite_id, level_id, type_id = project.id, suite.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            created = await client.post(
                f"{API_PREFIX}/test-cases",
                headers=auth,
                json={
                    "project_id": str(project_id),
                    "title": _unique_name("Case a73-solo"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]

            added = await client.post(
                f"{API_PREFIX}/test-suites/{suite_id}/test-cases/{case_id}", headers=auth
            )
            assert added.status_code == 201, (
                "a standalone TestCase must be addable to a suite in its own project — "
                f"got {added.status_code} {added.text}"
            )

            # And it really is a member, read back through the suite's own route.
            members = await client.get(f"{API_PREFIX}/test-suites/{suite_id}/test-cases", headers=auth)
            assert members.status_code == 200, members.text
            assert [item["id"] for item in members.json()["items"]] == [case_id]
    finally:
        async with AsyncSessionLocal() as session:
            if suite_ids:
                await session.execute(sa_delete(TestSuiteTestCase).where(TestSuiteTestCase.test_suite_id.in_(suite_ids)))
                await session.execute(sa_delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
            await session.commit()
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
