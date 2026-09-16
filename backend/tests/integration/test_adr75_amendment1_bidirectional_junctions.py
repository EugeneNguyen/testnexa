"""ADR-0075 Amendment 1 integration: all six junctions list from BOTH ends.

Real HTTP via `httpx.AsyncClient` against `TEST_API_BASE_URL`, reusing
`test_admin2_crud.py`'s and `test_admin2_execution_trace.py`'s seeding helpers
rather than duplicating them.

**Every test is a create-through-the-real-bespoke-route, then read-back round
trip — never a config-shape assertion.** This is the specific discipline
`backend/CLAUDE.md`'s resolver-completeness note (ADR-0029) prescribes, and it
is load-bearing here rather than ceremonial, because the failure mode this
amendment could most plausibly ship is exactly the one a config assertion
cannot see:

    `scope_field` widens to a 2-tuple, `derive_entity_relations` dutifully emits
    a relation for the new arm, the frontend renders a tab for it — and every
    request that tab fires 404s, because `resolve_org_id` was left walking the
    old arm only. `_resolve_scope_for_write` hands the resolver a
    `types.SimpleNamespace` carrying **only** the arm the caller supplied, so
    the old walk reads `None` and the whole chain collapses to "unresolvable
    tenant."

Nothing about that is visible from `ALL_ENTITY_CONFIGS`; the relation is
present and correct, the route exists, the permission is granted. Only firing
`GET /{entity}?{reverse_arm}=<id>` against a live server and getting the row
back proves it. So each test below does the same four things:

1. create the join row through the junction's **own real bespoke route**,
2. read the *reverse* parent's schema and find the newly-served relation,
3. fire the exact list request that relation describes, and assert the row,
4. assert the **original** direction still returns the identical row — the
   widening must add a direction, never trade one for the other.

Step 4 is what makes step 3 meaningful: a resolver that accidentally swapped
arms rather than branching would pass step 3 alone.

`tests/unit/test_adr75_amendment1_bidirectional_junctions.py` covers the
resolver branches in isolation (including the dangling-FK and orphan shapes no
live fixture can legally construct) and carries the mutation check proving the
pre-Amendment resolver genuinely fails these same inputs.
"""

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.assets import TestSuite, TestSuiteTestCase
from app.models.execution import TestExecutionResult
from app.models.planning import TestPlanTestSuite
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
    _create_test_execution,
    _create_test_plan,
)


async def _cleanup_membership_rows(*, suite_link_ids=None, plan_link_ids=None, suite_ids=None) -> None:
    """Child-first, for the two membership junctions `_cleanup_extra` doesn't know."""
    async with AsyncSessionLocal() as session:
        if suite_link_ids:
            await session.execute(delete(TestSuiteTestCase).where(TestSuiteTestCase.id.in_(suite_link_ids)))
        if plan_link_ids:
            await session.execute(delete(TestPlanTestSuite).where(TestPlanTestSuite.id.in_(plan_link_ids)))
        if suite_ids:
            await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        await session.commit()


def _relations(schema_body: dict) -> dict[str, dict]:
    return {relation["entity"]: relation for relation in schema_body["relations"]}


async def _assert_relation_lists(
    client: httpx.AsyncClient,
    auth: dict,
    *,
    parent_entity: str,
    link_entity: str,
    expected_scope_field: str,
    expected_label: str,
    expected_target_entity: str,
    expected_target_field: str,
    parent_id,
    far_id,
) -> str:
    """Schema -> relation -> fire its own list request -> assert the row. Returns the row id.

    Factored out because all six junctions are asserted through the identical
    three-link chain, and a copy per test would be six places for the chain to
    drift. Deliberately fires `GET /{relation.entity}?{relation.scopeField}=`
    built from the **served** relation's own fields rather than from literals —
    that is byte-for-byte what `EntityRelationTab.tsx` does, so a relation whose
    advertised scope field the route would 422 on fails here rather than in a
    browser.
    """
    schema = await client.get(f"{API_PREFIX}/entities/{parent_entity}/schema", headers=auth)
    assert schema.status_code == 200, schema.text
    relations = _relations(schema.json())
    assert link_entity in relations, (
        f"{parent_entity}'s schema does not advertise {link_entity} — the reverse "
        f"direction ADR-0075 Amendment 1 adds. Served: {sorted(relations)}"
    )
    relation = relations[link_entity]
    assert relation["kind"] == "many-to-many"
    assert relation["scopeField"] == expected_scope_field
    assert relation["label"] == expected_label
    # ADR-0074 §5: the tab is labelled and navigated by the FAR entity.
    assert relation["targetEntity"] == expected_target_entity
    assert relation["targetField"] == expected_target_field

    listed = await client.get(
        f"{API_PREFIX}/{relation['entity']}",
        params={relation["scopeField"]: str(parent_id)},
        headers=auth,
    )
    assert listed.status_code == 200, (
        f"the relation {parent_entity} -> {link_entity} is advertised but its own "
        f"list request failed: {listed.status_code} {listed.text}"
    )
    body = listed.json()
    assert body["total"] == 1, body
    row = body["items"][0]
    assert row[relation["scopeField"]] == str(parent_id)
    # `targetField` must name a real key holding the far record's id, or the
    # tab's row-click has nothing to navigate with.
    assert row[relation["targetField"]] == str(far_id)
    return row["id"]


# --- 1. requirement_test_case_link ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_requirement_test_case_link_lists_from_the_test_case_end_too() -> None:
    """**TC-ADMIN-078.** The case that started this: `GET /entities/test-cases/schema` carried no
    `requirement`/`test-suite` relation at all, so a `TestCase` detail page could
    not show the requirements tracing to it even though the link table was
    populated and the relationship is genuinely bidirectional.

    The link row is created through REQ-2's own real route
    (`POST /requirements/{id}/test-cases`, which writes the `TestCase` *and* the
    link in one transaction), never a direct ORM insert.
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
            admin, org = await _create_org_admin(session, "a1-rtc")
            project = await _create_project(session, org, "a1-rtc")
            requirement = await _create_requirement(session, project, "a1-rtc")
            level, type_ = await _create_taxonomy_pair(session, "a1-rtc")
            await session.commit()

            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, level_id, type_id = requirement.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            created = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                headers=auth,
                json={
                    "title": _unique_name("Case a1-rtc"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]

            # The NEW direction: TestCase -> the requirements linked to it.
            row_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="test-cases",
                link_entity="requirement-test-case-links",
                expected_scope_field="test_case_id",
                expected_label="Requirements (linked)",
                expected_target_entity="requirements",
                expected_target_field="requirement_id",
                parent_id=case_id,
                far_id=requirement_id,
            )
            link_ids = {"requirement_test_case_link": [row_id]}

            # The ORIGINAL direction must return the identical row — a resolver
            # that swapped arms instead of branching would pass the check above
            # and fail here.
            original = await _assert_relation_lists(
                client,
                auth,
                parent_entity="requirements",
                link_entity="requirement-test-case-links",
                expected_scope_field="requirement_id",
                expected_label="Test cases (linked)",
                expected_target_entity="test-cases",
                expected_target_field="test_case_id",
                parent_id=requirement_id,
                far_id=case_id,
            )
            assert original == row_id, "both directions must surface the same link row"
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


# --- 2 + 3. requirement_test_condition_link and test_condition_test_case_link --------------------


@pytest.mark.asyncio
async def test_the_two_test_condition_junctions_list_from_their_reverse_ends() -> None:
    """**TC-ADMIN-078.** Two junctions in one fixture, because REQ-3's rigor path builds both in
    sequence: `POST /requirements/{id}/test-conditions` writes the
    `RequirementTestConditionLink`, and `POST /test-conditions/{id}/test-cases`
    writes the `TestConditionTestCaseLink`.

    Also asserts the label-collision property ADR-0074 §5 depends on: after the
    widening, `TestCondition` serves a "Requirements (linked)" tab *and* a "Test
    cases (linked)" tab, and `TestCase` serves "Requirements (linked)" *and*
    "Test conditions (linked)" — four tabs whose labels must stay distinct or
    the strip is unreadable.
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
            admin, org = await _create_org_admin(session, "a1-cond")
            project = await _create_project(session, org, "a1-cond")
            requirement = await _create_requirement(session, project, "a1-cond")
            level, type_ = await _create_taxonomy_pair(session, "a1-cond")
            await session.commit()

            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token = _access_token_for(admin.actor_id)
            requirement_id, level_id, type_id = requirement.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            condition = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-conditions",
                headers=auth,
                json={"description": _unique_name("Condition a1"), "priority": "medium"},
            )
            assert condition.status_code == 201, condition.text
            condition_id = condition.json()["id"]
            test_condition_ids = [condition_id]

            case = await client.post(
                f"{API_PREFIX}/test-conditions/{condition_id}/test-cases",
                headers=auth,
                json={
                    "title": _unique_name("Case a1-cond"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert case.status_code == 201, case.text
            case_id = case.json()["id"]
            test_case_ids = [case_id]

            # NEW: TestCondition -> the requirements linked to it.
            rtc_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="test-conditions",
                link_entity="requirement-test-condition-links",
                expected_scope_field="test_condition_id",
                expected_label="Requirements (linked)",
                expected_target_entity="requirements",
                expected_target_field="requirement_id",
                parent_id=condition_id,
                far_id=requirement_id,
            )
            # NEW: TestCase -> the test conditions linked to it.
            ctc_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="test-cases",
                link_entity="test-condition-test-case-links",
                expected_scope_field="test_case_id",
                expected_label="Test conditions (linked)",
                expected_target_entity="test-conditions",
                expected_target_field="test_condition_id",
                parent_id=case_id,
                far_id=condition_id,
            )
            link_ids = {
                "requirement_test_condition_link": [rtc_id],
                "test_condition_test_case_link": [ctc_id],
            }

            # Both original directions unchanged.
            assert (
                await _assert_relation_lists(
                    client,
                    auth,
                    parent_entity="requirements",
                    link_entity="requirement-test-condition-links",
                    expected_scope_field="requirement_id",
                    expected_label="Test conditions (linked)",
                    expected_target_entity="test-conditions",
                    expected_target_field="test_condition_id",
                    parent_id=requirement_id,
                    far_id=condition_id,
                )
                == rtc_id
            )
            assert (
                await _assert_relation_lists(
                    client,
                    auth,
                    parent_entity="test-conditions",
                    link_entity="test-condition-test-case-links",
                    expected_scope_field="test_condition_id",
                    expected_label="Test cases (linked)",
                    expected_target_entity="test-cases",
                    expected_target_field="test_case_id",
                    parent_id=condition_id,
                    far_id=case_id,
                )
                == ctc_id
            )

            # Labels must stay distinct on both newly-multi-tab entities.
            for entity in ("test-cases", "test-conditions"):
                schema = await client.get(f"{API_PREFIX}/entities/{entity}/schema", headers=auth)
                labels = [relation["label"] for relation in schema.json()["relations"]]
                assert len(set(labels)) == len(labels), f"{entity} has duplicate tab labels: {labels}"
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


# --- 4. test_suite_test_case, 5. test_plan_test_suite --------------------------------------------


@pytest.mark.asyncio
async def test_the_two_membership_junctions_list_from_their_reverse_ends() -> None:
    """**TC-ADMIN-078.** ADR-0075's own two junctions, now bidirectional.

    `TestSuite` is the entity ADR-0075 gave its first tab; Amendment 1 gives it
    a second ("Test plans (linked)") and gives `TestCase` the reverse of the
    suite membership it never had. Both join rows are written through the real
    bespoke membership routes (ADR-0030 / ADR-0031).
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
    suite_ids: list = []
    suite_link_ids: list = []
    plan_link_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a1-mem")
            project = await _create_project(session, org, "a1-mem")
            requirement = await _create_requirement(session, project, "a1-mem")
            condition = await _create_test_condition(session, requirement, "a1-mem")
            level, type_ = await _create_taxonomy_pair(session, "a1-mem")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a1-mem",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a1-mem")
            suite = TestSuite(project_id=project.id, name=_unique_name("Suite a1-mem"))
            session.add(suite)
            await session.flush()
            await session.commit()

            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            test_plan_ids = [plan.id]
            suite_ids = [suite.id]
            token = _access_token_for(admin.actor_id)
            suite_id, case_id, plan_id = suite.id, case.id, plan.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            add = await client.post(
                f"{API_PREFIX}/test-suites/{suite_id}/test-cases/{case_id}", headers=auth
            )
            assert add.status_code == 201, add.text
            include = await client.post(
                f"{API_PREFIX}/test-plans/{plan_id}/test-suites/{suite_id}", headers=auth
            )
            assert include.status_code == 201, include.text

            # NEW: TestCase -> the suites containing it.
            suite_link_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="test-cases",
                link_entity="test-suite-test-cases",
                expected_scope_field="test_case_id",
                expected_label="Test suites (linked)",
                expected_target_entity="test-suites",
                expected_target_field="test_suite_id",
                parent_id=case_id,
                far_id=suite_id,
            )
            suite_link_ids = [suite_link_id]

            # NEW: TestSuite -> the plans including it. This is `TestSuite`'s
            # second tab; ADR-0075 gave it its first.
            plan_link_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="test-suites",
                link_entity="test-plan-test-suites",
                expected_scope_field="test_suite_id",
                expected_label="Test plans (linked)",
                expected_target_entity="test-plans",
                expected_target_field="test_plan_id",
                parent_id=suite_id,
                far_id=plan_id,
            )
            plan_link_ids = [plan_link_id]

            # Both original directions unchanged.
            assert (
                await _assert_relation_lists(
                    client,
                    auth,
                    parent_entity="test-suites",
                    link_entity="test-suite-test-cases",
                    expected_scope_field="test_suite_id",
                    expected_label="Test cases (linked)",
                    expected_target_entity="test-cases",
                    expected_target_field="test_case_id",
                    parent_id=suite_id,
                    far_id=case_id,
                )
                == suite_link_id
            )
            assert (
                await _assert_relation_lists(
                    client,
                    auth,
                    parent_entity="test-plans",
                    link_entity="test-plan-test-suites",
                    expected_scope_field="test_plan_id",
                    expected_label="Test suites (linked)",
                    expected_target_entity="test-suites",
                    expected_target_field="test_suite_id",
                    parent_id=plan_id,
                    far_id=suite_id,
                )
                == plan_link_id
            )

            # `TestSuite` now has exactly two tabs, in the derivation's own
            # stable order — asserted positionally because
            # `e2e/tests/admin7-entity-relation-tabs.spec.ts` asserts the
            # rendered strip the same way.
            schema = await client.get(f"{API_PREFIX}/entities/test-suites/schema", headers=auth)
            assert [r["label"] for r in schema.json()["relations"]] == [
                "Test cases (linked)",
                "Test plans (linked)",
            ]
    finally:
        await _cleanup_membership_rows(
            suite_link_ids=suite_link_ids, plan_link_ids=plan_link_ids, suite_ids=suite_ids
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


# --- 6. test_case_defect_link --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_defect_gains_its_first_relationship_tab_from_the_defect_arm() -> None:
    """**TC-ADMIN-078.** `Defect`'s detail page rendered **no tab strip at all** before Amendment 1
    — the same symptom ADR-0075 fixed for `TestSuite`, and equally
    indistinguishable from an entity that genuinely has no relationships.

    This arm also walks the longest new chain (`Defect` -> `TestExecution` ->
    `TestCycle` -> `TestPlan.project_id` -> `Project.org_id`), so it is the one
    most likely to 404 if the resolver were left single-armed. The link row is
    written by EXEC-3's real route (`POST /executions/{id}/defects`), which
    creates the `Defect` and its `TestCaseDefectLink` together.
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
    test_cycle_ids: list = []
    release_ids: list = []
    environment_ids: list = []
    test_execution_ids: list = []
    defect_ids: list = []
    link_ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "a1-def")
            project = await _create_project(session, org, "a1-def")
            requirement = await _create_requirement(session, project, "a1-def")
            condition = await _create_test_condition(session, requirement, "a1-def")
            level, type_ = await _create_taxonomy_pair(session, "a1-def")
            case = await _create_test_case(
                session,
                test_condition=condition,
                test_level=level,
                test_type=type_,
                created_by=admin.actor_id,
                tag="a1-def",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "a1-def")
            release = await _create_release(session, project, "a1-def")
            environment = await _create_environment_row(session, project, "a1-def")
            cycle = await _create_test_cycle(
                session, test_plan=plan, release=release, environment=environment, tag="a1-def"
            )
            execution = await _create_test_execution(
                session, test_cycle=cycle, test_case=case, executed_by=admin.actor_id, tag="a1-def"
            )
            # The shared helper seeds `passed`; EXEC-3's route rejects raising a
            # defect against anything but a failed execution ("Defects can only
            # be raised against a failed test execution", a 422), so flip it
            # here rather than hand-rolling a second execution helper.
            execution.result = TestExecutionResult.fail
            await session.commit()

            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            test_plan_ids = [plan.id]
            test_cycle_ids = [cycle.id]
            release_ids = [release.id]
            environment_ids = [environment.id]
            test_execution_ids = [execution.id]
            token = _access_token_for(admin.actor_id)
            execution_id, case_id = execution.id, case.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}

            raised = await client.post(
                f"{API_PREFIX}/executions/{execution_id}/defects",
                headers=auth,
                json={"external_ref": _unique_name("DEF-a1"), "severity": "high"},
            )
            assert raised.status_code == 201, raised.text
            defect_id = raised.json()["id"]
            defect_ids = [defect_id]

            # NEW: Defect -> the test cases linked to it. Previously `[]`.
            schema = await client.get(f"{API_PREFIX}/entities/defects/schema", headers=auth)
            assert schema.status_code == 200
            assert schema.json()["relations"] != [], (
                "Defect's relation set is empty — its detail page would render no tab strip"
            )

            row_id = await _assert_relation_lists(
                client,
                auth,
                parent_entity="defects",
                link_entity="test-case-defect-links",
                expected_scope_field="defect_id",
                expected_label="Test cases (linked)",
                expected_target_entity="test-cases",
                expected_target_field="test_case_id",
                parent_id=defect_id,
                far_id=case_id,
            )
            link_ids = {"test_case_defect_link": [row_id]}

            # The original direction still returns the identical row.
            assert (
                await _assert_relation_lists(
                    client,
                    auth,
                    parent_entity="test-cases",
                    link_entity="test-case-defect-links",
                    expected_scope_field="test_case_id",
                    expected_label="Defects (linked)",
                    expected_target_entity="defects",
                    expected_target_field="defect_id",
                    parent_id=case_id,
                    far_id=defect_id,
                )
                == row_id
            )
    finally:
        await _cleanup_extra(
            link_ids=link_ids,
            defect_ids=defect_ids,
            test_execution_ids=test_execution_ids,
            test_cycle_ids=test_cycle_ids,
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


# --- the tenant boundary on the new arm ----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_reverse_arm_enforces_the_same_404_tenant_boundary_as_the_original() -> None:
    """**TC-ADMIN-079.** A new scope arm is a new way into the resolver, so it is a new way to get
    the tenant boundary wrong — and the widening's whole mechanism is "add a
    branch to `resolve_org_id`," i.e. a direct edit to the function NFR-1 rests
    on for these entities.

    Asserts the boundary holds identically on both arms: an org_admin of a
    *different* org scoping by either end of a real link row gets `404`
    (never `403`, never an empty `200` — existence must not be confirmable
    across an org boundary, ADR-0007/NFR-1).

    The empty-`200` case is the one worth being explicit about: a resolver that
    resolved `None` and then fell through to an unfiltered query would return
    `{"total": 0}` here, which reads like a legitimately empty tab rather than
    a leak — but it would mean the request was never tenant-checked at all.
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
            admin, org = await _create_org_admin(session, "a1-nfr1")
            outsider, other_org = await _create_org_admin(session, "a1-nfr1-other")
            project = await _create_project(session, org, "a1-nfr1")
            requirement = await _create_requirement(session, project, "a1-nfr1")
            level, type_ = await _create_taxonomy_pair(session, "a1-nfr1")
            await session.commit()

            user_ids = [admin.actor_id, outsider.actor_id]
            org_ids = [org.id, other_org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_level_ids = [level.id]
            test_type_ids = [type_.id]
            token = _access_token_for(admin.actor_id)
            outsider_token = _access_token_for(outsider.actor_id)
            requirement_id, level_id, type_id = requirement.id, level.id, type_.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            auth = {"Authorization": f"Bearer {token}"}
            outsider_auth = {"Authorization": f"Bearer {outsider_token}"}

            created = await client.post(
                f"{API_PREFIX}/requirements/{requirement_id}/test-cases",
                headers=auth,
                json={
                    "title": _unique_name("Case a1-nfr1"),
                    "test_level_id": str(level_id),
                    "test_type_id": str(type_id),
                },
            )
            assert created.status_code == 201, created.text
            case_id = created.json()["id"]
            test_case_ids = [case_id]

            owner_view = await client.get(
                f"{API_PREFIX}/requirement-test-case-links",
                params={"test_case_id": str(case_id)},
                headers=auth,
            )
            assert owner_view.status_code == 200
            link_ids = {"requirement_test_case_link": [owner_view.json()["items"][0]["id"]]}

            for arm, value in (("test_case_id", case_id), ("requirement_id", requirement_id)):
                blocked = await client.get(
                    f"{API_PREFIX}/requirement-test-case-links",
                    params={arm: str(value)},
                    headers=outsider_auth,
                )
                assert blocked.status_code == 404, f"{arm}: got {blocked.status_code} {blocked.text}"
                assert blocked.json()["code"] == "not_found"

            # A syntactically valid but nonexistent id is the same 404 —
            # indistinguishable from the cross-tenant case above, which is the
            # whole point of NFR-1. Fired at BOTH arms, not just the new one:
            # the TC's claim is that the two arms behave identically, so
            # checking only the reverse arm would leave "the widening added an
            # asymmetry" untested in exactly the direction that matters.
            for arm in ("test_case_id", "requirement_id"):
                missing = await client.get(
                    f"{API_PREFIX}/requirement-test-case-links",
                    params={arm: "00000000-0000-0000-0000-000000000000"},
                    headers=auth,
                )
                assert missing.status_code == 404, f"{arm}: got {missing.status_code}"
                assert missing.json()["code"] == "not_found"
                # Byte-identical to the cross-org body above — a different
                # message or code on either arm would confirm existence.
                assert missing.json()["message"] == blocked.json()["message"]
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
