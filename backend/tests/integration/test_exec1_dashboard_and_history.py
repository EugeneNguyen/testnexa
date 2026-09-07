"""Integration tests for EXEC-1's two open claims (ADR-0034): the live
dashboard's aggregation correctness (TC-EXEC-002) and the re-execution-history
guarantee (TC-EXEC-003).

**No new backend route is under test here.** ADR-0034's whole posture is that
the backend was already load-bearing for this story as of ADR-0033/PLAN-3:
`POST /test-cycles/{id}/executions` exists and is gated, and the dashboard is
four calls to the *existing* generic factory list route
(`GET /test-executions?test_cycle_id=&result=&page_size=1`, reading `total`
only). What was missing was proof, not code — Test Design §30 says exactly
this ("this section covers only what §29 explicitly deferred"), so every
boundary class for the create route itself (404-vs-403, the PLAN-3 scope check
in both directions, the `executed_by_actor_id` stamping class, the
generic-route-removal regression) stays in `test_plan3_test_cycle_execution.py`
and is deliberately **not** duplicated here.

In particular **TC-EXEC-001 is already covered** and is not re-implemented
below: its literal wording — "`201`; row created with `executed_by_actor_id` =
caller's own `actor_id`, `executed_at` set, immediately readable via
`GET /test-executions/{id}`" — is asserted end to end by that module's
`test_executed_by_actor_id_is_stamped_from_the_authenticated_caller` (stamping
+ the stored row) together with `test_execution_scope_enforced_in_both
_directions` (the `201` for an in-scope case). Writing a third near-identical
test would add maintenance surface and no coverage.

Seeding/cleanup helpers are **imported** from
`test_plan3_test_cycle_execution.py` rather than copied. That module already
owns the FK-safe delete ordering for exactly this entity graph
(`TestExecution` -> `TestCycle` -> `TestPlan`/`Release`/`Environment` ->
`Project` -> `Actor`, every FK `RESTRICT`), and that ordering is the single
most breakage-prone part of a fixture here. Two hand-maintained copies of it
would be free to drift, and the failure mode of drift is a cleanup that
half-succeeds and leaves rows behind for the *next* test to trip over. The
sibling module's helpers are plain module-level functions with no fixture
state, so importing them is safe.

Real HTTP via `httpx.AsyncClient` against a live server (`TEST_API_BASE_URL`);
the package-level `conftest.py` skip-guard applies here too.
"""

import os
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.execution import TestExecution, TestExecutionResult

from tests.integration.test_plan3_test_cycle_execution import (
    _access_token_for,
    _add_case_to_suite,
    _cleanup,
    _create_condition_path_test_case,
    _create_environment,
    _create_org_admin,
    _create_project,
    _create_release,
    _create_requirement,
    _create_test_condition,
    _create_test_cycle,
    _create_test_level,
    _create_test_plan,
    _create_test_suite,
    _create_test_type,
    _include_suite_in_plan,
    _unique_name,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"

# The four `result` values, as they appear on the wire. NOTE the enum skew the
# sibling module also flags: the DB/API *value* is `"pass"` while the Python
# member is `TestExecutionResult.passed` (`pass` is a Python keyword).
_RESULT_VALUES = ("pass", "fail", "blocked", "skipped")

_PYTHON_MEMBER_BY_VALUE = {
    "pass": TestExecutionResult.passed,
    "fail": TestExecutionResult.fail,
    "blocked": TestExecutionResult.blocked,
    "skipped": TestExecutionResult.skipped,
}


def _test_executions_path() -> str:
    return f"{API_PREFIX}/test-executions"


def _test_execution_item_path(test_execution_id) -> str:
    return f"{API_PREFIX}/test-executions/{test_execution_id}"


def _cycle_executions_path(test_cycle_id) -> str:
    return f"{API_PREFIX}/test-cycles/{test_cycle_id}/executions"


async def _dashboard_total(client, headers, test_cycle_id, result: str) -> int:
    """One dashboard tile's own call, verbatim as `TestCycleDetail` makes it.

    `page_size=1` on purpose: the tile reads `total` and never touches `items`,
    so this asserts the exact request shape ADR-0034 commits the frontend to —
    not a more generous query that happens to produce the same number.
    """
    response = await client.get(
        _test_executions_path(),
        headers=headers,
        params={"test_cycle_id": str(test_cycle_id), "result": result, "page_size": 1},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "total" in body, f"the dashboard reads `total`; response had {sorted(body)}"
    return body["total"]


async def _seed_executions(session, cycle, test_case, actor_id, result_value: str, count: int):
    """`count` rows of one `result` value, seeded directly.

    Direct inserts rather than `count` HTTP POSTs: the create route is not what
    TC-EXEC-002 is testing (§29 already owns it), and the generic
    `POST /test-executions` no longer exists at all (ADR-0033), so this is also
    simply the available way to build a mixed fixture.

    `executed_at` is staggered so the rows are distinguishable and any
    ordering assertion elsewhere has something real to order by.
    """
    base = datetime.now(UTC)
    for index in range(count):
        session.add(
            TestExecution(
                test_cycle_id=cycle.id,
                test_case_id=test_case.id,
                executed_by_actor_id=actor_id,
                result=_PYTHON_MEMBER_BY_VALUE[result_value],
                actual_result=f"EXEC-1 seeded {result_value} #{index}",
                executed_at=base - timedelta(minutes=index),
            )
        )
    await session.flush()


# --- TC-EXEC-002: live dashboard aggregation ---------------------------------------------------


@pytest.mark.asyncio
async def test_dashboard_totals_match_each_seeded_result_count() -> None:  # TC-EXEC-002
    """TC-EXEC-002 literally: "Cycle has a mixed seeded set — at least one
    `pass`, one `fail`, one `blocked`, one `skipped`" -> "Call `GET
    /test-executions?test_cycle_id=&result=<value>&page_size=1` once per
    `result` value" -> "Each call's `total` matches that value's seeded count
    exactly, asserted independently for all four values in the same test".

    Three deliberate fixture choices, each closing a hole a lazier fixture
    would leave open (Test Design §30):

    1. **All four seeded counts are distinct** (4/3/2/1). A fixture seeding the
       same number of each — or only one value — cannot distinguish "correctly
       filtered per value" from "the `result` filter is silently ignored and
       every call returns the cycle's whole count": both pass identically. With
       distinct counts, an ignored filter returns 10 for all four and every
       assertion fails.
    2. **The grand total (10) equals none of the four counts**, so an ignored
       filter cannot coincidentally satisfy any single assertion either.
    3. **A second cycle in the same project** carries its own executions, and
       its zero-valued results are asserted to be `0` — §30's "a `TestCycle`
       with zero executions of a given value must independently assert that
       value's `total` is `0`, not omitted or erroring". This doubles as the
       cross-cycle scoping check: cycle B's rows must not leak into cycle A's
       tiles, which a `result`-only (un-scoped by `test_cycle_id`) filter would
       violate.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []

    # Distinct on purpose; sum (10) collides with none of them.
    seeded_counts = {"pass": 4, "fail": 3, "blocked": 2, "skipped": 1}
    # Cycle B: only `pass` rows, so the other three must each read exactly 0.
    seeded_counts_b = {"pass": 5, "fail": 0, "blocked": 0, "skipped": 0}

    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcexec002")
            project = await _create_project(session, org, "tcexec002")
            requirement = await _create_requirement(session, project, "tcexec002")
            condition = await _create_test_condition(session, requirement, "tcexec002")
            level = await _create_test_level(session, "tcexec002")
            test_type = await _create_test_type(session, "tcexec002")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcexec002"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tcexec002")
            suite = await _create_test_suite(session, project, "tcexec002")
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tcexec002")
            environment = await _create_environment(session, project, "tcexec002")

            cycle_a = await _create_test_cycle(session, plan, release, environment, "tcexec002-A")
            cycle_b = await _create_test_cycle(session, plan, release, environment, "tcexec002-B")

            for value, count in seeded_counts.items():
                await _seed_executions(session, cycle_a, case, admin.actor_id, value, count)
            for value, count in seeded_counts_b.items():
                await _seed_executions(session, cycle_b, case, admin.actor_id, value, count)

            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, cycle_a_id, cycle_b_id = admin.actor_id, cycle_a.id, cycle_b.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # "asserted independently for all four values in the same test" —
            # each value gets its own call and its own assertion, so a single
            # wrong value cannot be masked by the others being right.
            observed_a = {
                value: await _dashboard_total(client, headers, cycle_a_id, value)
                for value in _RESULT_VALUES
            }
            for value in _RESULT_VALUES:
                assert observed_a[value] == seeded_counts[value], (
                    f"cycle A's {value!r} tile must read exactly its own seeded count "
                    f"({seeded_counts[value]}), got {observed_a[value]}. "
                    f"All four: {observed_a}. If every value reads "
                    f"{sum(seeded_counts.values())}, the `result` filter is being ignored."
                )

            # §30's zero clause, plus cross-cycle scoping: cycle B has only
            # `pass` rows, so the other three read 0 even though cycle A (same
            # plan, same project) has plenty of each.
            observed_b = {
                value: await _dashboard_total(client, headers, cycle_b_id, value)
                for value in _RESULT_VALUES
            }
            for value in _RESULT_VALUES:
                assert observed_b[value] == seeded_counts_b[value], (
                    f"cycle B's {value!r} tile must read {seeded_counts_b[value]} "
                    f"(a zero must be a real 0, not omitted or an error), got "
                    f"{observed_b[value]}. All four: {observed_b}"
                )
            assert observed_b["fail"] == 0
            assert observed_b["blocked"] == 0
            assert observed_b["skipped"] == 0
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )


# --- TC-EXEC-003: re-execution preserves history -----------------------------------------------


@pytest.mark.asyncio
async def test_re_execution_inserts_a_new_row_and_leaves_the_first_untouched() -> None:  # TC-EXEC-003
    """TC-EXEC-003 literally: "TestCase already executed once in this cycle" ->
    "`POST` a second execution for the same `test_cycle_id`+`test_case_id`
    (different `result`)" -> "`201` with a distinct `id`; both rows
    independently readable via `GET /test-executions/{id}`; the first row's
    `result`/`actual_result`/`executed_at` unchanged after the second `POST` —
    new row inserted, old row untouched".

    Test Design §30 names three fronts and this test asserts all three in one
    place, because each alone is insufficient:

    (a) `201` both times with two **distinct** ids — not a `200`/idempotent
        update on the second call.
    (b) both rows independently readable via `GET /test-executions/{id}`.
    (c) the **first** row's `result`/`actual_result`/`executed_at` are
        byte-for-byte unchanged after the second `POST`.

    (c) is the one that actually proves "not an overwrite". Asserting only (a)
    would still pass an accidental upsert-on-`(test_cycle_id, test_case_id)`
    that happened to return a fresh `id` on update — which is precisely why the
    first row's full body is captured *before* the second POST and compared
    field-by-field *after* it, rather than merely re-read for a `200`.

    The two POSTs deliberately differ in `result` **and** `actual_result`
    **and** `executed_at`: an overwrite that only clobbered one of the three
    would slip past a single-field assertion.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    requirement_ids: list = []
    test_suite_ids: list = []
    test_condition_ids: list = []
    test_case_ids: list = []
    test_level_ids: list = []
    test_type_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "tcexec003")
            project = await _create_project(session, org, "tcexec003")
            requirement = await _create_requirement(session, project, "tcexec003")
            condition = await _create_test_condition(session, requirement, "tcexec003")
            level = await _create_test_level(session, "tcexec003")
            test_type = await _create_test_type(session, "tcexec003")
            case = await _create_condition_path_test_case(
                session, condition, admin.actor_id, level, test_type, "tcexec003"
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "tcexec003")
            suite = await _create_test_suite(session, project, "tcexec003")
            # The case must be genuinely in scope, or both POSTs would 422 on
            # the ADR-0033 scope check and this test would prove nothing.
            await _include_suite_in_plan(session, plan, suite)
            await _add_case_to_suite(session, suite, case)
            release = await _create_release(session, project, "tcexec003")
            environment = await _create_environment(session, project, "tcexec003")
            cycle = await _create_test_cycle(session, plan, release, environment, "tcexec003")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            requirement_ids = [requirement.id]
            test_condition_ids = [condition.id]
            test_case_ids = [case.id]
            test_suite_ids = [suite.id]
            test_level_ids = [level.id]
            test_type_ids = [test_type.id]
            admin_id, cycle_id, case_id = admin.actor_id, cycle.id, case.id

        headers = {"Authorization": f"Bearer {_access_token_for(admin_id)}"}
        first_executed_at = datetime(2026, 9, 7, 10, 0, 0, tzinfo=UTC).isoformat()
        second_executed_at = datetime(2026, 9, 7, 15, 30, 0, tzinfo=UTC).isoformat()
        first_notes = _unique_name("First run notes tcexec003")
        second_notes = _unique_name("Second run notes tcexec003")

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # --- Precondition: "TestCase already executed once in this cycle".
            first = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_id),
                    "result": "fail",
                    "actual_result": first_notes,
                    "executed_at": first_executed_at,
                },
            )
            assert first.status_code == 201, first.text
            first_body = first.json()
            first_id = first_body["id"]

            # (c)'s baseline, captured BEFORE the second POST — this is the
            # snapshot the "unchanged" claim is checked against.
            before = await client.get(_test_execution_item_path(first_id), headers=headers)
            assert before.status_code == 200, before.text
            first_row_before = before.json()
            assert first_row_before["result"] == "fail"
            assert first_row_before["actual_result"] == first_notes

            # --- The re-run: same cycle, same case, different result.
            second = await client.post(
                _cycle_executions_path(cycle_id),
                headers=headers,
                json={
                    "test_case_id": str(case_id),
                    "result": "pass",
                    "actual_result": second_notes,
                    "executed_at": second_executed_at,
                },
            )

            # (a) `201` again — not a `200`, which is what an idempotent
            # update-in-place would return — and a genuinely distinct id.
            assert second.status_code == 201, (
                f"a re-run must INSERT (201), never update in place: {second.text}"
            )
            second_body = second.json()
            second_id = second_body["id"]
            assert second_id != first_id, (
                f"the second execution must be its own row, not the first one "
                f"returned again: {first_id} vs {second_id}"
            )
            assert second_body["test_cycle_id"] == str(cycle_id)
            assert second_body["test_case_id"] == str(case_id)
            assert second_body["result"] == "pass"

            # (b) both rows independently readable.
            after_first = await client.get(_test_execution_item_path(first_id), headers=headers)
            after_second = await client.get(_test_execution_item_path(second_id), headers=headers)
            assert after_first.status_code == 200, after_first.text
            assert after_second.status_code == 200, after_second.text
            assert after_second.json()["id"] == second_id

            # (c) the first row is byte-for-byte unchanged. Compared as whole
            # bodies first (catches a clobber of *any* field, including ones
            # this test didn't think to name), then field-by-field so a failure
            # says which field moved.
            first_row_after = after_first.json()
            assert first_row_after == first_row_before, (
                "the first execution's row must be untouched by the second POST — "
                f"before: {first_row_before}, after: {first_row_after}"
            )
            for field in ("result", "actual_result", "executed_at"):
                assert first_row_after[field] == first_row_before[field], (
                    f"the first row's {field!r} changed after the second POST: "
                    f"{first_row_before[field]!r} -> {first_row_after[field]!r}"
                )
            assert first_row_after["result"] == "fail"
            assert first_row_after["actual_result"] == first_notes

            # The history list the UI renders genuinely holds both rows.
            listed = await client.get(
                _test_executions_path(),
                headers=headers,
                params={"test_cycle_id": str(cycle_id), "page_size": 50},
            )
            assert listed.status_code == 200, listed.text
            listed_body = listed.json()
            assert listed_body["total"] == 2, listed_body
            assert {item["id"] for item in listed_body["items"]} == {first_id, second_id}

        # And the DB agrees: two distinct rows for the one (cycle, case) pair.
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TestExecution.id).where(
                    TestExecution.test_cycle_id == cycle_id,
                    TestExecution.test_case_id == case_id,
                )
            )
            row_ids = {row[0] for row in result.all()}
        assert len(row_ids) == 2, (
            f"exactly two rows must exist for this (cycle, case) pair — an upsert "
            f"would leave one: {row_ids}"
        )
    finally:
        await _cleanup(
            user_ids=user_ids,
            org_ids=org_ids,
            project_ids=project_ids,
            requirement_ids=requirement_ids,
            test_suite_ids=test_suite_ids,
            test_condition_ids=test_condition_ids,
            test_case_ids=test_case_ids,
            test_level_ids=test_level_ids,
            test_type_ids=test_type_ids,
        )
