"""ADR-0077 integration: the four bespoke traceability link-*delete* routes.

Real HTTP via `httpx.AsyncClient` against `TEST_API_BASE_URL`, reusing
`test_admin2_crud.py`'s / `test_admin2_execution_trace.py`'s seeding helpers and
`test_adr76_link_create_routes.py`'s own `_grant_custom_role`/`_cleanup_roles`
rather than duplicating any of them.

Covers TC-ADMIN-109 (link-then-unlink-then-list round trip, all four routes),
TC-ADMIN-110 (`404` on a pair that is not linked, all four routes),
TC-ADMIN-111 (cross-tenant `404`), and TC-ADMIN-112 (permission `403`, and the
create/delete codes proven non-interchangeable in both directions).

**Every positive test creates the link through the real `POST`, deletes it
through the real `DELETE`, and then fires the relation's own scoped list
request to prove it is gone** — never a `204`-response assertion on its own.
That is the delete-side counterpart of ADR-0076's create-side discipline, and
it is load-bearing for a specific reason: `_delete_link` looks the row up by
its FK *pair*, and a lookup keyed on the wrong column (or a route wired to the
wrong model) would still return `204` for a pair that genuinely exists while
deleting the wrong row, or nothing at all. Only a read-back can tell the
difference — `backend/CLAUDE.md`'s own "create-then-read, not create-only"
rule, pointed at the other verb.

The list request is built from the **served relation** (`GET
/{relation.entity}?{relation.scopeField}=`), not from a literal path, so it is
byte-for-byte the request `EntityRelationTab.tsx` re-fires after its own
"Remove" action succeeds. A route that deletes a row the tab then still shows
fails here rather than in a browser.

**Two boundaries are asserted per route rather than assumed from the create
side's tests**, because they are decided by different code:

- `404` for a pair that is not linked — ADR-0030's deliberate asymmetry with
  `POST`'s `409`, inherited by all four. Deliberately **not** an idempotent
  `204`: a client that unlinks twice must learn the second call did nothing.
- `404`, never `403`/`422`, for a far row in another organization (NFR-1/
  ADR-0007). The gate is shared with the `POST` (literally the same
  `_gate_parent` call), which is the reason it can be trusted — but "the same
  function is called" is a claim about the source, and this asserts the
  behaviour.
"""

import uuid

import httpx
import pytest

from app.db.session import AsyncSessionLocal
from tests.integration.test_admin2_crud import (
    API_PREFIX,
    TEST_API_BASE_URL,
    _access_token_for,
    _create_org_admin,
    _create_project,
    _create_requirement,
    _create_taxonomy_pair,
    _create_test_case,
    _create_test_condition,
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
from tests.integration.test_adr76_link_create_routes import _cleanup_roles, _grant_custom_role


async def _link_unlink_and_confirm_gone(
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
) -> None:
    """POST the link, DELETE it, then prove it is gone via the relation's own list.

    `path` is the same URL for both verbs, which is itself part of the
    contract: `linkCreate.pathTemplate` and `linkDelete.pathTemplate` are
    served separately (a future junction may differ) but for all six today they
    are equal, and a route pair that disagreed would fail on the `DELETE`'s own
    status rather than silently.

    Five assertions, ordered so a failure is diagnosable:

    1. the `POST` is a `201` — there is a real row to remove,
    2. it is visible through the relation's list — the precondition the last
       assertion is measured against, so "gone" cannot pass vacuously,
    3. the `DELETE` is a `204` with an empty body,
    4. the relation's list no longer contains it,
    5. a second `DELETE` of the same pair is `404` — not an idempotent `204`.
    """
    created = await client.post(path, headers=auth)
    assert created.status_code == 201, f"POST {path} -> {created.status_code} {created.text}"

    schema = await client.get(f"{API_PREFIX}/entities/{parent_entity}/schema", headers=auth)
    assert schema.status_code == 200, schema.text
    relations = {relation["entity"]: relation for relation in schema.json()["relations"]}
    assert link_entity in relations, sorted(relations)
    relation = relations[link_entity]
    assert relation["scopeField"] == scope_field

    async def _far_ids() -> list[str]:
        listed = await client.get(
            f"{API_PREFIX}/{relation['entity']}",
            params={relation["scopeField"]: str(parent_id)},
            headers=auth,
        )
        assert listed.status_code == 200, listed.text
        return [row[relation["targetField"]] for row in listed.json()["items"]]

    # The precondition. Without this the "gone" assertion below would pass
    # identically against a link that was never created.
    assert str(far_id) in await _far_ids(), "the link this test is about to remove was never visible"

    removed = await client.request("DELETE", path, headers=auth)
    assert removed.status_code == 204, f"DELETE {path} -> {removed.status_code} {removed.text}"
    assert removed.content in (b"", None), removed.content

    assert str(far_id) not in await _far_ids(), (
        f"{path} returned 204 but the link row is still listed through its own relation — "
        f"the pair lookup removed the wrong row, or nothing at all"
    )

    # ADR-0030's asymmetry, inherited: a DELETE's "already true" case is
    # `404`, never a second `204`.
    again = await client.request("DELETE", path, headers=auth)
    assert again.status_code == 404, again.text
    assert again.json()["code"] == "not_found"


# --- TC-ADMIN-109 / TC-ADMIN-110: all four routes, round trip + already-gone ------------------


@pytest.mark.asyncio
async def test_unlink_test_case_from_requirement_round_trip() -> None:  # TC-ADMIN-109, TC-ADMIN-110
    """`DELETE /requirements/{id}/test-case-links/{test_case_id}`.

    The `TestCase` is created standalone (REQ-5/ADR-0069's `project_id` shape),
    the same shape ADR-0076's own round trip uses — so this also re-exercises
    `resolve_test_case_project_id` on the tenant walk the unlink's shared
    `_gate_parent` performs.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a77-rtc")
            project = await _create_project(session, org, "a77-rtc")
            requirement = await _create_requirement(session, project, "a77-rtc")
            level, type_ = await _create_taxonomy_pair(session, "a77-rtc")
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, project_id, level_id, type_id = requirement.id, project.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            created = await client.post(
                f"{API_PREFIX}/test-cases",
                headers=auth,
                json={
                    "project_id": str(project_id),
                    "title": _unique_name("Case a77-rtc"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]

            await _link_unlink_and_confirm_gone(
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

            # The far row itself survives — the whole distinction between
            # "Remove" and "Delete". Asserted on the real `GET`, not inferred.
            still_there = await client.get(f"{API_PREFIX}/test-cases/{case_id}", headers=auth)
            assert still_there.status_code == 200, still_there.text

            # ...and the pair can be linked again, which is what makes
            # ADR-0005's immutable delete-and-recreate model actually usable.
            relinked = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}", headers=auth
            )
            assert relinked.status_code == 201, relinked.text
            await client.request(
                "DELETE",
                f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}",
                headers=auth,
            )
    finally:
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
async def test_unlink_test_condition_from_requirement_round_trip() -> None:  # TC-ADMIN-109, TC-ADMIN-110
    """`DELETE /requirements/{id}/test-condition-links/{test_condition_id}`.

    Also pins the mirror of the `POST`'s own "a condition may be traced to its
    own owning requirement" rule: unlinking it removes the ADR-0005 *link* row
    and leaves `TestCondition.requirement_id` — REQ-3's owning FK — untouched.
    The condition is seeded under this very requirement precisely so that
    distinction is exercised rather than described.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a77-rtcond")
            project = await _create_project(session, org, "a77-rtcond")
            requirement = await _create_requirement(session, project, "a77-rtcond")
            condition = await _create_test_condition(session, requirement, "a77-rtcond")
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, condition_id = requirement.id, condition.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            await _link_unlink_and_confirm_gone(
                client,
                auth,
                path=f"{API_PREFIX}/requirements/{requirement_id}/test-condition-links/{condition_id}",
                parent_entity="requirements",
                link_entity="requirement-test-condition-links",
                scope_field="requirement_id",
                target_field="test_condition_id",
                parent_id=requirement_id,
                far_id=condition_id,
            )

            # The owning FK is untouched: the condition still belongs to this
            # requirement through REQ-3's rigor path, which is a different
            # relationship from the traceability link just removed.
            condition_row = await client.get(f"{API_PREFIX}/test-conditions/{condition_id}", headers=auth)
            assert condition_row.status_code == 200, condition_row.text
            assert condition_row.json()["requirement_id"] == str(requirement_id)
    finally:
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_condition_ids=test_condition_ids,
        )


@pytest.mark.asyncio
async def test_unlink_test_case_from_test_condition_round_trip() -> None:  # TC-ADMIN-109, TC-ADMIN-110
    """`DELETE /test-conditions/{id}/test-case-links/{test_case_id}`.

    The one route of the four whose parent is a `TestCondition`, so its
    `_gate_parent` walks the two-hop `TestCondition -> Requirement -> Project`
    chain rather than a one-hop one — worth its own round trip for that reason
    alone.
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
            admin, org = await _create_org_admin(session, "a77-ctc")
            project = await _create_project(session, org, "a77-ctc")
            requirement = await _create_requirement(session, project, "a77-ctc")
            condition = await _create_test_condition(session, requirement, "a77-ctc")
            level, type_ = await _create_taxonomy_pair(session, "a77-ctc")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a77-ctc",
            )
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            condition_id, case_id = condition.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            await _link_unlink_and_confirm_gone(
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

            # `TestCase.test_condition_id` — the rigor-path owning FK — is
            # untouched, exactly as the requirement/condition route above.
            case_row = await client.get(f"{API_PREFIX}/test-cases/{case_id}", headers=auth)
            assert case_row.status_code == 200, case_row.text
            assert case_row.json()["test_condition_id"] == str(condition_id)
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


@pytest.mark.asyncio
async def test_unlink_defect_from_test_case_round_trip() -> None:  # TC-ADMIN-109, TC-ADMIN-110
    """`DELETE /test-cases/{id}/defect-links/{defect_id}`.

    The deepest tenant walk of the four on the far side (`Defect ->
    TestExecution -> TestCycle -> TestPlan -> Project`), and the one link
    `tester` also holds the `.delete` code for.

    The `Defect` here is seeded with its own `TestExecution` provenance, and
    that provenance is asserted intact afterwards: EXEC-3's
    `POST /executions/{id}/defects` writes this same link row as a side effect
    of raising a defect, so "unlink" must not be confusable with "un-raise".
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    test_plan_ids: list = []
    execution_ids: list = []
    cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    defect_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a77-tcd")
            project = await _create_project(session, org, "a77-tcd")
            requirement = await _create_requirement(session, project, "a77-tcd")
            condition = await _create_test_condition(session, requirement, "a77-tcd")
            level, type_ = await _create_taxonomy_pair(session, "a77-tcd")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a77-tcd",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a77-tcd")
            release = await _create_release(session, project, "a77-tcd")
            environment = await _create_environment_row(session, project, "a77-tcd")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a77-tcd"
            )
            execution = await _create_test_execution(
                session, test_cycle=cycle, test_case=case, executed_by=admin.actor_id, tag="a77-tcd"
            )
            defect = await _create_defect(session, test_execution=execution, reported_by=admin.actor_id, tag="a77-tcd")
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            test_plan_ids, execution_ids, cycle_ids = [plan.id], [execution.id], [cycle.id]
            release_ids, environment_ids, defect_ids = [release.id], [environment.id], [defect.id]
            token = _access_token_for(admin.actor_id)
            case_id, defect_id, execution_id = case.id, defect.id, execution.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            await _link_unlink_and_confirm_gone(
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

            # The Defect survives with its execution provenance — unlinking is
            # not un-raising.
            defect_row = await client.get(f"{API_PREFIX}/defects/{defect_id}", headers=auth)
            assert defect_row.status_code == 200, defect_row.text
            assert defect_row.json()["test_execution_id"] == str(execution_id)
    finally:
        await _cleanup_extra(
            test_execution_ids=execution_ids,
            test_cycle_ids=cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
            defect_ids=defect_ids,
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
            test_plan_ids=test_plan_ids,
        )


@pytest.mark.asyncio
async def test_unlinking_a_pair_that_was_never_linked_is_404_on_every_route() -> None:  # TC-ADMIN-110
    """The `404`-not-`204` rule, asserted for a pair that has *never* existed.

    The round-trip tests above cover "already removed"; this covers "never
    linked at all", which reaches the same branch by a different history and is
    the case a client hits when two people work the same tab. Both are `404`,
    and neither is an idempotent `204` (ADR-0030's asymmetry with `POST`'s
    `409`, inherited by all four routes).

    A real, in-tenant far row is used for each — a random uuid would `404` for
    the far row's own sake and prove nothing about the pair lookup.
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
            admin, org = await _create_org_admin(session, "a77-gone")
            project = await _create_project(session, org, "a77-gone")
            requirement = await _create_requirement(session, project, "a77-gone")
            condition = await _create_test_condition(session, requirement, "a77-gone")
            level, type_ = await _create_taxonomy_pair(session, "a77-gone")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a77-gone",
            )
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids, test_condition_ids = [requirement.id], [condition.id]
            test_case_ids = [case.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, condition_id, case_id = requirement.id, condition.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            # Three of the four; the fourth (`defect-links`) needs a whole
            # execution chain to produce an in-tenant far row and is covered by
            # its own round trip's second-DELETE assertion above.
            for path in (
                f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}",
                f"{API_PREFIX}/requirements/{requirement_id}/test-condition-links/{condition_id}",
                f"{API_PREFIX}/test-conditions/{condition_id}/test-case-links/{case_id}",
            ):
                response = await client.request("DELETE", path, headers=auth)
                assert response.status_code == 404, f"{path} -> {response.status_code} {response.text}"
                assert response.json()["code"] == "not_found", path
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


# --- TC-ADMIN-111: the tenant boundary --------------------------------------------------------


@pytest.mark.asyncio
async def test_unlinking_against_a_parent_in_another_org_is_404_not_403() -> None:  # TC-ADMIN-111
    """NFR-1/ADR-0007: existence is never confirmable across a tenant boundary.

    The caller is a real `org_admin` of org A holding every permission that
    exists, so nothing but the *parent's* tenant stands between them and the
    route — and a `403` here would confirm the `Requirement` exists in org B.

    Asserted for the unlink specifically rather than inherited from the create
    side's own test: the two verbs share `_gate_parent` by construction, but
    "the same function is called" is a claim about the source, and a route
    wired to the wrong resolver would still compile.
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
            admin, org_a = await _create_org_admin(session, "a77-x1")
            project_a = await _create_project(session, org_a, "a77-x1")

            other_admin, org_b = await _create_org_admin(session, "a77-x2")
            project_b = await _create_project(session, org_b, "a77-x2")
            requirement_b = await _create_requirement(session, project_b, "a77-x2")
            condition_b = await _create_test_condition(session, requirement_b, "a77-x2")
            level, type_ = await _create_taxonomy_pair(session, "a77-x")
            case_b = await _create_test_case(
                session,
                test_condition=condition_b,
                test_level=level,
                test_type=type_,
                created_by=other_admin.actor_id,
                tag="a77-x2",
            )
            await session.commit()

            user_ids = [admin.actor_id, other_admin.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids, test_condition_ids = [requirement_b.id], [condition_b.id]
            test_case_ids = [case_b.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_b_id, condition_b_id, case_b_id = requirement_b.id, condition_b.id, case_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # Every route, parent-side: org A's admin has no membership in B.
            for path in (
                f"{API_PREFIX}/requirements/{requirement_b_id}/test-case-links/{case_b_id}",
                f"{API_PREFIX}/requirements/{requirement_b_id}/test-condition-links/{condition_b_id}",
                f"{API_PREFIX}/test-conditions/{condition_b_id}/test-case-links/{case_b_id}",
                f"{API_PREFIX}/test-cases/{case_b_id}/defect-links/{uuid.uuid4()}",
            ):
                response = await client.request("DELETE", path, headers=auth)
                assert response.status_code == 404, f"{path} -> {response.status_code} {response.text}"
                assert response.json()["code"] == "not_found", path
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


# --- TC-ADMIN-112: the permission gate --------------------------------------------------------


@pytest.mark.asyncio
async def test_the_create_and_delete_codes_are_not_interchangeable() -> None:  # TC-ADMIN-112
    """The reason ADR-0077 mints new codes rather than reusing `.create`.

    Two members of the same org, each holding exactly one of the pair, each
    asserted against **both** verbs — so the test fails if either code
    accidentally gates both, in either direction. A single-direction test
    ("the delete-holder can delete") would pass identically against a route
    that gated on `.create`.

    `403`, not `404`: the caller is a real member of the org and the parent
    exists, so there is no existence left to hide — only an authorization
    answer (ADR-0030's own boundary order, which `_gate_parent` implements
    once for both verbs).
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    role_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a77-perm")
            project = await _create_project(session, org, "a77-perm")
            requirement = await _create_requirement(session, project, "a77-perm")
            level, type_ = await _create_taxonomy_pair(session, "a77-perm")

            # `requirement.read` is included in both bundles so the members can
            # reach the parent at all — without it the route 403s for the wrong
            # reason and the test proves nothing about the link codes.
            creator, creator_role = await _grant_custom_role(
                session, org, "a77-c", ["requirement.read", "requirement_test_case_link.create"]
            )
            remover, remover_role = await _grant_custom_role(
                session, org, "a77-d", ["requirement.read", "requirement_test_case_link.delete"]
            )
            await session.commit()

            user_ids = [admin.actor_id, creator.actor_id, remover.actor_id]
            org_ids, project_ids = [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            role_ids = [creator_role.id, remover_role.id]
            admin_token = _access_token_for(admin.actor_id)
            creator_token = _access_token_for(creator.actor_id)
            remover_token = _access_token_for(remover.actor_id)
            requirement_id, project_id, level_id, type_id = requirement.id, project.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            admin_auth = {"Authorization": f"Bearer {admin_token}"}
            created = await client.post(
                f"{API_PREFIX}/test-cases",
                headers=admin_auth,
                json={
                    "project_id": str(project_id),
                    "title": _unique_name("Case a77-perm"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]
            path = f"{API_PREFIX}/requirements/{requirement_id}/test-case-links/{case_id}"

            creator_auth = {"Authorization": f"Bearer {creator_token}"}
            remover_auth = {"Authorization": f"Bearer {remover_token}"}

            # The create-only holder may link...
            linked = await client.post(path, headers=creator_auth)
            assert linked.status_code == 201, linked.text
            # ...and may NOT unlink. This is the half a symmetric-permission
            # implementation would silently allow.
            refused = await client.request("DELETE", path, headers=creator_auth)
            assert refused.status_code == 403, refused.text
            assert refused.json()["code"] == "permission_denied"

            # The delete-only holder may not link...
            refused_create = await client.post(path, headers=remover_auth)
            assert refused_create.status_code == 403, refused_create.text
            assert refused_create.json()["code"] == "permission_denied"
            # ...and may unlink, which also proves the `403`s above are about
            # the codes rather than about these members being unable to reach
            # the route at all.
            removed = await client.request("DELETE", path, headers=remover_auth)
            assert removed.status_code == 204, removed.text
    finally:
        await _cleanup_roles(role_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
