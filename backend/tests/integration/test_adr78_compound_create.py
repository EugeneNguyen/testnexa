"""ADR-0078 integration: `compoundCreates` on the served schema, the widened
`TestExecution` list scope, and the three compound-create paths end to end.

Real HTTP via `httpx.AsyncClient` against `TEST_API_BASE_URL`, reusing
`test_admin2_crud.py`'s / `test_admin2_execution_trace.py`'s / `test_adr76_
link_create_routes.py`'s seeding helpers rather than duplicating them — same
posture `test_adr76_link_create_routes.py` itself takes.

Covers TC-ADMIN-118 .. TC-ADMIN-123:

- **TC-ADMIN-118** — `GET /entities/{resource}/schema` serves the new
  `compoundCreates` key for all six link entities and for a non-link entity.
  Asserted as a full deep-equality against every serialized field (including
  `linksAutomatically`, `parentEntity`, `parentLabel`, `parentLabelField` and
  `parentFilters`), not a presence check: the three live declarations differ
  from each other in exactly those fields, so a spot-check on the key's
  existence would pass even if every value were swapped between them.
- **TC-ADMIN-119** — the `_TEST_EXECUTION_CONFIG.scope_field` widening.
  `?test_case_id=` used to `422` and must now `200` with *only* that case's
  rows; `?test_cycle_id=` must still `200` (the regression half); both arms at
  once and neither arm are each a `422` per `extract_scope_value`'s exactly-one
  rule; and `?test_case_id=&result=fail` must narrow further, which is the
  literal request the `Defect` action's `parentFilters` makes the picker send.
- **TC-ADMIN-120 / 121 / 122** — the three declarations' own central claim
  actually exercised. Every one of them is a **create-through-the-real-route
  then read-back through the junction's own scoped list request**, never a
  create-response assertion: `backend/CLAUDE.md`'s resolver-completeness rule
  (ADR-0029) exists because a bespoke create can `201` a perfectly good row
  and then `404`/vanish on the very next read, and a create-only assertion
  structurally cannot catch that.
- **TC-ADMIN-123** — the boundaries on the compound path: cross-tenant `404`
  (never `403` — NFR-1/ADR-0007 existence-hiding), membership-without-
  permission `403`, and the non-failed-execution `422` that is the entire
  reason `parentFilters={"result": "fail"}` exists on the `Defect` action.

TC-ADMIN-122 carries a second assertion that is not a boundary case but the
*justification* for the `Defect` action's whole picker design: the route writes
`TestCaseDefectLink(test_case_id=execution.test_case_id)`, so an execution
belonging to a **different** test case produces a link under *that* case, not
the one the tab is on. `linksAutomatically=True` is therefore only exact
*inside* a picker scoped to this test case's own executions — which is what the
`TestExecution` scope widening above is for. Both directions are asserted in
the one test, because a check that always looked under the right case (or
always under the wrong one) would each pass a test asserting only one.
"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import delete, or_, select

from app.db.session import AsyncSessionLocal
from app.models.assets import TestCase, TestCondition
from app.models.execution import Defect, TestExecution, TestExecutionResult
from app.models.trace import (
    RequirementTestConditionLink,
    TestCaseDefectLink,
    TestConditionTestCaseLink,
)
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
    _create_environment_row,
    _create_release,
    _create_test_cycle,
    _create_test_plan,
)
from tests.integration.test_adr76_link_create_routes import _cleanup_roles, _grant_custom_role

#: The exact `compoundCreates` list every entity's schema must serve, keyed by
#: the plural-hyphenated `:entity` route slug `GET /entities/{resource}/schema`
#: takes. Six link entities plus one ordinary non-link entity.
#:
#: Three of the six carry a one-element list; the other three keep `[]` — their
#: far entity already has a generic `create`, so ADR-0076 Amendment 1's own
#: composition covers them and there is nothing for this key to substitute for.
#: `requirements` is here as the non-link control: the key must be present and
#: empty on a plain entity too, so a client reads "no compound create" off a
#: `find` that misses rather than off the key's absence.
EXPECTED_COMPOUND_CREATES: dict[str, list[dict]] = {
    "requirement-test-case-links": [],
    "requirement-test-condition-links": [
        {
            "farField": "test_condition_id",
            "pathTemplate": "/requirements/{requirement_id}/test-conditions",
            "permission": "test_condition.create",
            # REQ-3's atomic route writes THIS junction's row itself.
            "linksAutomatically": True,
            # The placeholder names the tab's own scope field, so no picker.
            "parentEntity": None,
            "parentLabel": None,
            "parentLabelField": None,
            "parentFilters": {},
            # No parent to select — `parent_select` defaults to `False` and is
            # inert here, but the key is always present (ADR-0087 Amendment 2).
            "parentSelect": False,
        }
    ],
    "test-condition-test-case-links": [
        {
            "farField": "test_condition_id",
            "pathTemplate": "/requirements/{requirement_id}/test-conditions",
            "permission": "test_condition.create",
            # Same route, different direction: it writes the *requirement*
            # link, not this one, so the client must follow with `link_create`.
            "linksAutomatically": False,
            "parentEntity": "requirement",
            "parentLabel": "Requirement",
            "parentLabelField": "description",
            "parentFilters": {},
            "parentSelect": True,
        }
    ],
    "test-case-defect-links": [
        {
            "farField": "defect_id",
            "pathTemplate": "/executions/{test_execution_id}/defects",
            "permission": "defect.create",
            "linksAutomatically": True,
            "parentEntity": "test-execution",
            "parentLabel": "Failed test execution",
            # NOT `result` (the FK's own `label_field`) — every option in a
            # `result=fail`-filtered picker would read "fail".
            "parentLabelField": "executed_at",
            "parentFilters": {"result": "fail"},
            "parentSelect": True,
        }
    ],
    "test-plan-test-suites": [],
    "test-suite-test-cases": [],
    "requirements": [],
}


async def _create_execution(session, *, test_cycle, test_case, executed_by, result, tag: str):
    """Seed one `TestExecution` with an explicit `result`.

    `test_admin2_execution_trace._create_execution` hardcodes
    `TestExecutionResult.passed`; this module needs both arms — a failed one for
    the `Defect` route's own precondition and a passing one to prove the
    `result=fail` filter actually narrows.
    """
    execution = TestExecution(
        test_cycle_id=test_cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=executed_by,
        result=result,
        actual_result=f"ADR-0078 seeded execution {tag}",
        executed_at=datetime.now(UTC),
    )
    session.add(execution)
    await session.flush()
    return execution


async def _cleanup_route_defects(
    *, test_case_ids: list | None = None, defect_ids: list | None = None
) -> None:
    """Step 1 of cleanup: the `Defect` rows the route under test raised, and
    their auto-written `TestCaseDefectLink` rows.

    Must run **before** `_cleanup_extra` deletes the executions, because
    `Defect.test_execution_id` is `RESTRICT`.
    """
    test_case_ids = list(test_case_ids or [])
    defect_ids = list(defect_ids or [])
    if not (test_case_ids or defect_ids):
        return
    async with AsyncSessionLocal() as session:
        clauses = []
        if test_case_ids:
            clauses.append(TestCaseDefectLink.test_case_id.in_(test_case_ids))
        if defect_ids:
            clauses.append(TestCaseDefectLink.defect_id.in_(defect_ids))
        await session.execute(delete(TestCaseDefectLink).where(or_(*clauses)))
        if defect_ids:
            await session.execute(delete(Defect).where(Defect.id.in_(defect_ids)))
        await session.commit()


async def _cleanup_route_conditions(
    *, requirement_ids: list | None = None, test_case_ids: list | None = None
) -> None:
    """Step 3 of cleanup: the `TestCondition` rows the atomic route created and
    both of their junction tables.

    Keyed on the seeded `Requirement` ids rather than on ids returned by an HTTP
    call, so a test that fails partway through (before it could record what a
    route created) still cleans up after itself — `_crud_cleanup`'s own
    `test_condition_ids` can only ever know the rows the fixture seeded.

    Must run **after** `_cleanup_extra` has removed the executions, because it
    also drops any `TestCase` hanging off one of these conditions
    (`TestCase.test_condition_id` is `RESTRICT`) and
    `TestExecution.test_case_id` is `RESTRICT` in turn.
    """
    requirement_ids = list(requirement_ids or [])
    test_case_ids = list(test_case_ids or [])
    if not (requirement_ids or test_case_ids):
        return

    async with AsyncSessionLocal() as session:
        condition_ids: list = []
        if requirement_ids:
            result = await session.execute(
                select(TestCondition.id).where(TestCondition.requirement_id.in_(requirement_ids))
            )
            condition_ids = [row[0] for row in result.all()]

        if condition_ids or test_case_ids:
            clauses = []
            if condition_ids:
                clauses.append(TestConditionTestCaseLink.test_condition_id.in_(condition_ids))
            if test_case_ids:
                clauses.append(TestConditionTestCaseLink.test_case_id.in_(test_case_ids))
            await session.execute(delete(TestConditionTestCaseLink).where(or_(*clauses)))

        if condition_ids or requirement_ids:
            clauses = []
            if condition_ids:
                clauses.append(RequirementTestConditionLink.test_condition_id.in_(condition_ids))
            if requirement_ids:
                clauses.append(RequirementTestConditionLink.requirement_id.in_(requirement_ids))
            await session.execute(delete(RequirementTestConditionLink).where(or_(*clauses)))

        if condition_ids:
            await session.execute(
                delete(TestCase).where(TestCase.test_condition_id.in_(condition_ids))
            )
            await session.execute(delete(TestCondition).where(TestCondition.id.in_(condition_ids)))
        await session.commit()


async def _defect_ids_for_executions(execution_ids: list) -> list:
    """Every `Defect` the route under test raised against these executions.

    Used by the cleanup path so a mid-test failure still removes the defect
    rows, without the test having to have recorded their ids first.
    """
    if not execution_ids:
        return []
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Defect.id).where(Defect.test_execution_id.in_(execution_ids))
        )
        return [row[0] for row in result.all()]


# --- TC-ADMIN-118: the served `compoundCreates` key -------------------------------------------


@pytest.mark.asyncio
async def test_schema_serves_compound_creates_for_every_link_entity() -> None:  # TC-ADMIN-118
    """`GET /entities/{resource}/schema` -> `compoundCreates`, all six link
    entities plus a non-link control.

    A full deep-equality per entity, not a presence check. The three live
    declarations are distinguished from each other *only* by
    `linksAutomatically`/`parentEntity`/`parentLabel`/`parentLabelField`/
    `parentFilters` — two of them even share the same `pathTemplate`,
    `permission` and `farField` — so any assertion weaker than comparing every
    serialized field would pass with the two `TestCondition` directions swapped,
    which is exactly the mistake the per-direction declaration exists to
    prevent.
    """
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a78-118")
            await session.commit()
            user_ids, org_ids = [admin.actor_id], [org.id]
            token = _access_token_for(admin.actor_id)

        # An explicit timeout, unlike the rest of this file: this is the one
        # test that fires seven sequential requests back to back, and it is the
        # one that tripped httpx's 5s default on a host running several sibling
        # isolated stacks (root `CLAUDE.md`'s documented contention class — the
        # same run passed clean alone seconds later). Nothing here is
        # latency-sensitive; the assertions are about the served body.
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL, timeout=30.0) as client:
            auth = {"Authorization": f"Bearer {token}"}
            for resource, expected in EXPECTED_COMPOUND_CREATES.items():
                response = await client.get(
                    f"{API_PREFIX}/entities/{resource}/schema", headers=auth
                )
                assert response.status_code == 200, f"{resource}: {response.text}"
                body = response.json()
                assert "compoundCreates" in body, (
                    f"{resource}: the key must always be present (a LIST, `[]` when none) so a "
                    f"client reads 'no compound create' off a miss, not off the key's absence"
                )
                assert isinstance(body["compoundCreates"], list), body["compoundCreates"]
                assert body["compoundCreates"] == expected, (
                    f"{resource}: compoundCreates mismatch\n"
                    f"  served:   {body['compoundCreates']}\n"
                    f"  expected: {expected}"
                )
    finally:
        await _crud_cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-ADMIN-119: the widened `TestExecution` list scope --------------------------------------


@pytest.mark.asyncio
async def test_test_execution_list_accepts_either_scope_arm_but_never_both() -> None:  # TC-ADMIN-119
    """`GET /test-executions` under the widened `scope_field` 2-tuple.

    Five clauses in one test, because they are five answers to one question
    (`extract_scope_value`'s exactly-one rule applied to the new pair) and a
    fix or regression scoped to one arm must not be able to pass the others:

    1. `?test_case_id=` -> `200`, and **only** that case's executions (this
       arm `422`'d outright before ADR-0078),
    2. `?test_cycle_id=` -> `200` still — the regression half,
    3. both arms at once -> `422`,
    4. neither arm -> `422`,
    5. `?test_case_id=&result=fail` -> narrowed to the failed row, which is
       the literal request the `Defect` action's `parentFilters` makes.
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
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a78-119")
            project = await _create_project(session, org, "a78-119")
            requirement = await _create_requirement(session, project, "a78-119")
            condition = await _create_test_condition(session, requirement, "a78-119")
            level, type_ = await _create_taxonomy_pair(session, "a78-119")
            case_x = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a78-119-x",
            )
            case_y = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a78-119-y",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a78-119")
            release = await _create_release(session, project, "a78-119")
            environment = await _create_environment_row(session, project, "a78-119")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a78-119"
            )
            # Case X: one failed + one passing run, so the `result=fail` filter
            # has something to actually exclude. Case Y: one run, so the
            # `?test_case_id=X` scope has something to actually exclude.
            exec_x_fail = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_x,
                executed_by=admin.actor_id,
                result=TestExecutionResult.fail,
                tag="119-x-fail",
            )
            exec_x_pass = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_x,
                executed_by=admin.actor_id,
                result=TestExecutionResult.passed,
                tag="119-x-pass",
            )
            exec_y = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_y,
                executed_by=admin.actor_id,
                result=TestExecutionResult.passed,
                tag="119-y",
            )
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case_x.id, case_y.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            test_plan_ids = [plan.id]
            cycle_ids = [cycle.id]
            release_ids, environment_ids = [release.id], [environment.id]
            execution_ids = [exec_x_fail.id, exec_x_pass.id, exec_y.id]
            token = _access_token_for(admin.actor_id)
            case_x_id, case_y_id, cycle_id = case_x.id, case_y.id, cycle.id
            fail_id, pass_id, y_id = exec_x_fail.id, exec_x_pass.id, exec_y.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # 1. The new arm: `200`, and only case X's own executions.
            by_case = await client.get(
                f"{API_PREFIX}/test-executions",
                params={"test_case_id": str(case_x_id)},
                headers=auth,
            )
            assert by_case.status_code == 200, (
                f"?test_case_id= must be a legal scope arm after the widening "
                f"(it 422'd before): {by_case.status_code} {by_case.text}"
            )
            returned = {row["id"] for row in by_case.json()["items"]}
            assert returned == {str(fail_id), str(pass_id)}, by_case.json()
            assert str(y_id) not in returned, "another test case's execution leaked into the scope"

            # 2. The regression half: the original arm still works.
            by_cycle = await client.get(
                f"{API_PREFIX}/test-executions",
                params={"test_cycle_id": str(cycle_id)},
                headers=auth,
            )
            assert by_cycle.status_code == 200, by_cycle.text
            cycle_rows = {row["id"] for row in by_cycle.json()["items"]}
            assert {str(fail_id), str(pass_id), str(y_id)} <= cycle_rows, by_cycle.json()

            # 3. Both arms at once -> 422 (`extract_scope_value`'s exactly-one rule).
            both = await client.get(
                f"{API_PREFIX}/test-executions",
                params={"test_cycle_id": str(cycle_id), "test_case_id": str(case_x_id)},
                headers=auth,
            )
            assert both.status_code == 422, both.text
            assert both.json()["code"] == "validation_error", both.json()

            # 4. Neither arm -> 422 as well, never an unscoped cross-tenant list.
            neither = await client.get(f"{API_PREFIX}/test-executions", headers=auth)
            assert neither.status_code == 422, neither.text
            assert neither.json()["code"] == "validation_error", neither.json()

            # 5. The picker's literal request: the new arm plus `result=fail`.
            filtered = await client.get(
                f"{API_PREFIX}/test-executions",
                params={"test_case_id": str(case_x_id), "result": "fail"},
                headers=auth,
            )
            assert filtered.status_code == 200, filtered.text
            filtered_rows = filtered.json()["items"]
            assert {row["id"] for row in filtered_rows} == {str(fail_id)}, filtered.json()
            assert all(row["result"] == "fail" for row in filtered_rows), filtered.json()
            assert str(case_y_id) not in filtered.text
    finally:
        await _cleanup_extra(
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
            test_plan_ids=test_plan_ids,
        )


# --- TC-ADMIN-120: the Requirement direction, `linksAutomatically=True` ------------------------


@pytest.mark.asyncio
async def test_requirement_direction_links_the_junction_row_automatically() -> None:  # TC-ADMIN-120
    """`POST /requirements/{id}/test-conditions`, then **immediately**
    `GET /requirement-test-condition-links?requirement_id=` — with no link call
    of any kind in between.

    This is the literal proof of `linksAutomatically=True` for the
    `requirement_test_condition_link` declaration: exactly one request, and the
    junction row the tab lists is already there. Deliberately a create-then-
    read round trip rather than an assertion on the `201` body
    (`backend/CLAUDE.md`'s resolver-completeness rule / ADR-0029) — the
    `TestCondition` row and the link row both insert in one transaction, and
    only the subsequent scoped *read* can show the link is reachable through
    the resolver the tab's own list request walks.

    The `409` at the end closes the claim from the other side: the pair already
    exists, so the second call ADR-0076 Amendment 1's composition would have
    made is not merely unnecessary, it would fail.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a78-120")
            project = await _create_project(session, org, "a78-120")
            requirement = await _create_requirement(session, project, "a78-120")
            await session.commit()
            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            token = _access_token_for(admin.actor_id)
            requirement_id = requirement.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # The one and only write, at exactly the declared `pathTemplate`.
            created = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-conditions",
                headers=auth,
                json={"description": _unique_name("Condition a78-120"), "priority": "high"},
            )
            assert created.status_code == 201, created.text
            condition_id = created.json()["id"]
            assert created.json()["requirement_id"] == str(requirement_id), created.json()

            # ...and the junction row is already listable, no second call.
            listed = await client.get(
                f"{API_PREFIX}/requirement-test-condition-links",
                params={"requirement_id": str(requirement_id)},
                headers=auth,
            )
            assert listed.status_code == 200, (
                f"the link row the atomic route just wrote is unreadable through the junction's "
                f"own scoped list request: {listed.status_code} {listed.text}"
            )
            rows = listed.json()["items"]
            assert [row["test_condition_id"] for row in rows] == [condition_id], (
                f"linksAutomatically=True claims one request is enough; the junction shows "
                f"{rows} for requirement {requirement_id}"
            )

            # The pair exists, so `link_create` on it is a 409 — the second call
            # is not just redundant, it would fail.
            again = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-condition-links/{condition_id}",
                headers=auth,
            )
            assert again.status_code == 409, again.text
            assert again.json()["code"] == "link_already_exists", again.json()
    finally:
        await _cleanup_route_conditions(requirement_ids=requirement_ids)
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
        )


# --- TC-ADMIN-121: the TestCase direction, `linksAutomatically=False` --------------------------


@pytest.mark.asyncio
async def test_test_case_direction_needs_the_second_link_call() -> None:  # TC-ADMIN-121
    """The two-step direction: atomic create under the picked `Requirement`,
    then this junction's own `link_create`, then the scoped read-back.

    `linksAutomatically=False` says the first call writes the *requirement*
    link, not this one — so the assertion that matters is the one between the
    two calls: after the create alone, `GET /test-condition-test-case-links?
    test_case_id=` is still empty, and only the second request populates it.
    Asserting just the end state would pass identically if the route had
    silently linked the test case too.
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
            admin, org = await _create_org_admin(session, "a78-121")
            project = await _create_project(session, org, "a78-121")
            requirement = await _create_requirement(session, project, "a78-121")
            level, type_ = await _create_taxonomy_pair(session, "a78-121")
            await session.commit()
            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, project_id = requirement.id, project.id
            level_id, type_id = level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # The tab's own record: a standalone `TestCase` (REQ-5/ADR-0069's
            # `project_id` shape), created through its real generic route.
            case = await client.post(
                f"{API_PREFIX}/test-cases",
                headers=auth,
                json={
                    "project_id": str(project_id),
                    "title": _unique_name("Case a78-121"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert case.status_code == 201, case.text
            case_id = case.json()["id"]
            test_case_ids = [case_id]

            # Step 1 — the compound action's first call, at the declared
            # `pathTemplate`, parented by the *picked* requirement.
            created = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-conditions",
                headers=auth,
                json={"description": _unique_name("Condition a78-121"), "priority": "medium"},
            )
            assert created.status_code == 201, created.text
            condition_id = created.json()["id"]

            # `linksAutomatically=False`: nothing on this junction yet.
            before = await client.get(
                f"{API_PREFIX}/test-condition-test-case-links",
                params={"test_case_id": str(case_id)},
                headers=auth,
            )
            assert before.status_code == 200, before.text
            assert before.json()["items"] == [], (
                "the atomic route must write the *requirement* link only — a row here already "
                "would make linksAutomatically=False wrong for this direction"
            )

            # Step 2 — this junction's own `link_create`.
            linked = await client.post(
                f"{API_PREFIX}/test-conditions/{condition_id}/test-case-links/{case_id}",
                headers=auth,
            )
            assert linked.status_code == 201, linked.text
            assert linked.json()["test_condition_id"] == condition_id, linked.json()
            assert linked.json()["test_case_id"] == case_id, linked.json()

            # ...and now the tab's own scoped read shows it.
            after = await client.get(
                f"{API_PREFIX}/test-condition-test-case-links",
                params={"test_case_id": str(case_id)},
                headers=auth,
            )
            assert after.status_code == 200, after.text
            rows = after.json()["items"]
            assert [row["test_condition_id"] for row in rows] == [condition_id], after.json()
    finally:
        await _cleanup_route_conditions(
            requirement_ids=requirement_ids, test_case_ids=test_case_ids
        )
        await _crud_cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-ADMIN-122: the Defect direction, and why its picker must be scoped ---------------------


@pytest.mark.asyncio
async def test_defect_direction_links_to_the_executions_own_test_case() -> None:  # TC-ADMIN-122
    """`POST /executions/{id}/defects` against a **failed** execution of test
    case X, then `GET /test-case-defect-links?test_case_id=X` — no separate
    link call, proving `linksAutomatically=True` for this direction.

    Then the second, load-bearing half: the same route fired against a failed
    execution of a **different** test case Y writes its link row under Y, and
    `?test_case_id=X` does *not* show it. That is the whole justification for
    the action's `parentEntity`/`parentFilters` picker design — the route links
    to `execution.test_case_id`, never to the tab's own record, so
    `linksAutomatically=True` is only exact *inside* a picker scoped to this
    test case's own failed executions (which is what the `TestExecution`
    `scope_field` widening in TC-ADMIN-119 makes possible). An unscoped picker
    would silently file the defect against someone else's test case.
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
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a78-122")
            project = await _create_project(session, org, "a78-122")
            requirement = await _create_requirement(session, project, "a78-122")
            condition = await _create_test_condition(session, requirement, "a78-122")
            level, type_ = await _create_taxonomy_pair(session, "a78-122")
            case_x = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a78-122-x",
            )
            case_y = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a78-122-y",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a78-122")
            release = await _create_release(session, project, "a78-122")
            environment = await _create_environment_row(session, project, "a78-122")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a78-122"
            )
            exec_x = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_x,
                executed_by=admin.actor_id,
                result=TestExecutionResult.fail,
                tag="122-x",
            )
            exec_y = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_y,
                executed_by=admin.actor_id,
                result=TestExecutionResult.fail,
                tag="122-y",
            )
            await session.commit()

            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case_x.id, case_y.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            test_plan_ids = [plan.id]
            cycle_ids = [cycle.id]
            release_ids, environment_ids = [release.id], [environment.id]
            execution_ids = [exec_x.id, exec_y.id]
            token = _access_token_for(admin.actor_id)
            case_x_id, case_y_id = case_x.id, case_y.id
            exec_x_id, exec_y_id = exec_x.id, exec_y.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            # The one and only write for the in-scope case, at the declared
            # `pathTemplate`.
            raised = await client.post(
                f"{API_PREFIX}/executions/{exec_x_id}/defects",
                headers=auth,
                json={"severity": "high", "external_ref": _unique_name("DEF-122-x")},
            )
            assert raised.status_code == 201, raised.text
            defect_x_id = raised.json()["id"]
            assert raised.json()["test_execution_id"] == str(exec_x_id), raised.json()

            # ...and the junction row is already there, under X, no link call.
            under_x = await client.get(
                f"{API_PREFIX}/test-case-defect-links",
                params={"test_case_id": str(case_x_id)},
                headers=auth,
            )
            assert under_x.status_code == 200, (
                f"the link row the atomic route just wrote is unreadable through the junction's "
                f"own scoped list request: {under_x.status_code} {under_x.text}"
            )
            assert [row["defect_id"] for row in under_x.json()["items"]] == [defect_x_id], (
                f"linksAutomatically=True claims one request is enough: {under_x.json()}"
            )

            # The justification for the scoped picker: the same route against a
            # failed execution of a DIFFERENT test case files the link under
            # that case, not this tab's.
            other = await client.post(
                f"{API_PREFIX}/executions/{exec_y_id}/defects",
                headers=auth,
                json={"severity": "low", "external_ref": _unique_name("DEF-122-y")},
            )
            assert other.status_code == 201, other.text
            defect_y_id = other.json()["id"]

            under_y = await client.get(
                f"{API_PREFIX}/test-case-defect-links",
                params={"test_case_id": str(case_y_id)},
                headers=auth,
            )
            assert under_y.status_code == 200, under_y.text
            assert [row["defect_id"] for row in under_y.json()["items"]] == [defect_y_id], (
                f"the route links to execution.test_case_id, so this defect must land under "
                f"case Y: {under_y.json()}"
            )

            # ...and X's own tab still shows only its own defect.
            under_x_again = await client.get(
                f"{API_PREFIX}/test-case-defect-links",
                params={"test_case_id": str(case_x_id)},
                headers=auth,
            )
            assert under_x_again.status_code == 200, under_x_again.text
            x_defects = {row["defect_id"] for row in under_x_again.json()["items"]}
            assert x_defects == {defect_x_id}, under_x_again.json()
            assert defect_y_id not in x_defects, (
                "a defect raised from another test case's execution must NOT appear under this "
                "one — this is exactly why the execution picker has to be scoped to the tab's "
                "own test case (parentEntity/parentFilters), not to every failed execution"
            )
    finally:
        await _cleanup_route_defects(
            test_case_ids=test_case_ids,
            defect_ids=await _defect_ids_for_executions(execution_ids),
        )
        await _cleanup_extra(
            test_execution_ids=execution_ids,
            test_cycle_ids=cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _cleanup_route_conditions(
            requirement_ids=requirement_ids, test_case_ids=test_case_ids
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


# --- TC-ADMIN-123: boundaries on the compound path ---------------------------------------------


@pytest.mark.asyncio
async def test_compound_create_boundaries_404_403_and_non_failed_422() -> None:  # TC-ADMIN-123
    """Three boundaries, one fixture, because all three guard the same compound
    path and each is a different layer of it:

    1. **Cross-tenant `404`, never `403`** — an `org_admin` of org A holding
       every permission posts a `TestCondition` under org B's `Requirement`.
       NFR-1/ADR-0007: a `403` (or any other code) would confirm the
       requirement exists across the tenant boundary.
    2. **Membership without the permission -> `403`** — a member of org A
       holding a real but unrelated permission (`requirement.read`, so the
       rejection cannot be a blanket has-no-role one) posts under org A's own
       requirement. This is the code the declaration's `permission` field
       names, so the affordance can be hidden before the attempt.
    3. **Non-failed execution -> `422`** — `POST /executions/{id}/defects`
       against a passing execution. This is the entire reason the `Defect`
       action carries `parentFilters={"result": "fail"}`: offering a passed
       execution in the picker would be offering a guaranteed rejection.
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
    role_ids: list = []
    execution_ids: list = []
    cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "a78-123-a")
            project_a = await _create_project(session, org_a, "a78-123-a")
            requirement_a = await _create_requirement(session, project_a, "a78-123-a")
            condition_a = await _create_test_condition(session, requirement_a, "a78-123-a")
            level, type_ = await _create_taxonomy_pair(session, "a78-123")
            case_a = await _create_test_case(
                session,
                test_condition=condition_a,
                test_level=level,
                test_type=type_,
                created_by=admin_a.actor_id,
                tag="a78-123-a",
            )
            plan = await _create_test_plan(session, project_a, admin_a.actor_id, "a78-123")
            release = await _create_release(session, project_a, "a78-123")
            environment = await _create_environment_row(session, project_a, "a78-123")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a78-123"
            )
            # Deliberately PASSING — the 422 case.
            passing_execution = await _create_execution(
                session,
                test_cycle=cycle,
                test_case=case_a,
                executed_by=admin_a.actor_id,
                result=TestExecutionResult.passed,
                tag="123-pass",
            )

            # A second, fully separate tenant the org-A admin has no membership in.
            _admin_b, org_b = await _create_org_admin(session, "a78-123-b")
            project_b = await _create_project(session, org_b, "a78-123-b")
            requirement_b = await _create_requirement(session, project_b, "a78-123-b")

            # A real member of org A holding something, just not the gate's code.
            weak_user, weak_role = await _grant_custom_role(
                session, org_a, "a78-123-weak", ["requirement.read"]
            )
            await session.commit()

            user_ids = [admin_a.actor_id, _admin_b.actor_id, weak_user.actor_id]
            org_ids = [org_a.id, org_b.id]
            project_ids = [project_a.id, project_b.id]
            requirement_ids = [requirement_a.id, requirement_b.id]
            test_condition_ids = [condition_a.id]
            test_case_ids = [case_a.id]
            test_level_ids, test_type_ids = [level.id], [type_.id]
            test_plan_ids = [plan.id]
            cycle_ids = [cycle.id]
            release_ids, environment_ids = [release.id], [environment.id]
            execution_ids = [passing_execution.id]
            role_ids = [weak_role.id]
            admin_token = _access_token_for(admin_a.actor_id)
            weak_token = _access_token_for(weak_user.actor_id)
            requirement_a_id, requirement_b_id = requirement_a.id, requirement_b.id
            passing_execution_id = passing_execution.id

        body = {"description": _unique_name("Condition a78-123"), "priority": "medium"}
        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            admin_auth = {"Authorization": f"Bearer {admin_token}"}
            weak_auth = {"Authorization": f"Bearer {weak_token}"}

            # 1. Cross-tenant: 404, never 403.
            cross = await client.post(
                f"{API_PREFIX}/requirements/{requirement_b_id}/test-conditions",
                headers=admin_auth,
                json=body,
            )
            assert cross.status_code == 404, (
                f"a cross-tenant compound create must be 404 (existence never confirmable, "
                f"NFR-1) — got {cross.status_code} {cross.text}"
            )
            assert cross.json()["code"] == "not_found", cross.json()
            # And a requirement that simply does not exist is indistinguishable.
            missing = await client.post(
                f"{API_PREFIX}/requirements/{uuid.uuid4()}/test-conditions",
                headers=admin_auth,
                json=body,
            )
            assert missing.status_code == 404, missing.text
            assert missing.json()["code"] == cross.json()["code"], (
                "a cross-tenant requirement and a nonexistent one must return the identical "
                "error code, or the boundary leaks existence"
            )

            # 2. Membership present, `test_condition.create` missing: 403.
            denied = await client.post(
                f"{API_PREFIX}/requirements/{requirement_a_id}/test-conditions",
                headers=weak_auth,
                json=body,
            )
            assert denied.status_code == 403, (
                f"a member of this org without test_condition.create must be 403, not 404 — "
                f"got {denied.status_code} {denied.text}"
            )
            assert denied.json()["code"] == "permission_denied", denied.json()

            # 3. A passing execution: 422, the reason parentFilters exists.
            not_failed = await client.post(
                f"{API_PREFIX}/executions/{passing_execution_id}/defects",
                headers=admin_auth,
                json={"severity": "medium"},
            )
            assert not_failed.status_code == 422, (
                f"POST /executions/{{id}}/defects against a non-failed execution must be 422 "
                f"(EXEC-3 AC1's precondition) — got {not_failed.status_code} {not_failed.text}"
            )
            assert not_failed.json()["code"] == "validation_error", not_failed.json()
            # Nothing was written: the junction stays empty for this test case.
            still_empty = await client.get(
                f"{API_PREFIX}/test-case-defect-links",
                params={"test_case_id": str(test_case_ids[0])},
                headers=admin_auth,
            )
            assert still_empty.status_code == 200, still_empty.text
            assert still_empty.json()["items"] == [], still_empty.json()
    finally:
        await _cleanup_route_defects(
            test_case_ids=test_case_ids,
            defect_ids=await _defect_ids_for_executions(execution_ids),
        )
        await _cleanup_extra(
            test_execution_ids=execution_ids,
            test_cycle_ids=cycle_ids,
            release_ids=release_ids,
            environment_ids=environment_ids,
        )
        await _cleanup_route_conditions(
            requirement_ids=requirement_ids, test_case_ids=test_case_ids
        )
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
            test_plan_ids=test_plan_ids,
            role_ids=role_ids,
        )
