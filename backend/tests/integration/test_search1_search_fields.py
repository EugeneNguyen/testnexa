"""Integration tests for ADR-0070 — the `search_fields` audit + numeric `?q=`.

Covers **TC-ADMIN-044, TC-ADMIN-045, TC-ADMIN-046** and the corrected negative
half of **TC-ADMIN-013**, from `docs/test-cases/2026-09-03-test-cases.md`.

Real HTTP against a live server (`TEST_API_BASE_URL`), same seeding conventions
as `test_admin2_crud.py`/`test_plan3_test_cycle_execution.py`, whose helpers
this module reuses (the cross-module import precedent
`test_admin2_execution_trace.py`/`test_exec2_append_only_test_log.py` already
established).

Two distinct claims are under test, and they failed *differently* before this ADR:

1. **String search on a newly-searchable entity.** 23 of 27 entity configs had
   no `search_fields`, so `?q=` was silently ignored (ADR-0022's documented
   no-op) and the list came back unfiltered. The failure mode was a *wrong
   result set*, never an error — which is why it went unnoticed:
   `GET /test-plans?q=anything` returned 200 with every row. Every string test
   here therefore asserts the non-matching row is **absent**, and compares
   against the same call with `?q=` omitted: a presence-only assertion passes
   identically against the bug.

2. **Numeric search.** Postgres has no `integer ~~* unknown` operator, so
   before `_search_clause`'s `CAST` a numeric column in `search_fields` was not
   "unsupported" — it was a hard `ProgrammingError` 500. These tests prove what
   the unit tests structurally cannot: the cast yields a *runnable* statement
   against real Postgres, not merely plausible compiled SQL.
"""

import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.assets import TestStep, TestSuite
from app.models.execution import TestLog, TestLogEventType
from app.models.planning import Environment
from tests.integration.test_admin2_crud import (
    _access_token_for,
    _cleanup,
    _create_org_admin,
    _create_project,
    _create_requirement,
    _create_taxonomy_pair,
    _create_test_case,
    _create_test_condition,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"


def _needle(tag: str) -> str:
    """A token that cannot collide with any other row in a shared cloned DB."""
    return f"SEARCH1-{tag}-{uuid4().hex[:10]}"


async def _list(client, path: str, token: str, params: dict) -> dict:
    response = await client.get(
        f"{API_PREFIX}{path}", params=params, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, f"{path} {params} -> {response.status_code}: {response.text}"
    return response.json()


def _ids(body: dict) -> set[str]:
    return {item["id"] for item in body["items"]}


async def _seed_case_with_steps(session, tag: str, sequences: list[int]):
    """Seed org/project/requirement/condition/taxonomy/case + one `TestStep`
    per entry in `sequences`. Returns `(admin, org, project, requirement,
    condition, level, type_, case, steps)` — callers pass the ids straight
    into `_cleanup`."""
    admin, org = await _create_org_admin(session, tag)
    project = await _create_project(session, org, tag)
    requirement = await _create_requirement(session, project, tag)
    condition = await _create_test_condition(session, requirement, tag)
    level, type_ = await _create_taxonomy_pair(session, tag)
    case = await _create_test_case(
        session,
        test_condition=condition,
        test_level=level,
        test_type=type_,
        created_by=admin.actor_id,
        tag=tag,
    )
    steps = [
        TestStep(test_case_id=case.id, sequence=seq, action=f"step number {seq}") for seq in sequences
    ]
    session.add_all(steps)
    await session.flush()
    await session.commit()
    return admin, org, project, requirement, condition, level, type_, case, steps


# --- TC-ADMIN-044: string search on an entity that had no `search_fields` before ------------------


@pytest.mark.asyncio
async def test_string_search_on_newly_searchable_test_plan() -> None:  # TC-ADMIN-044
    """TC-ADMIN-044. `TestPlan` is the entity from the original bug report: no
    `search_fields` at all, so `GET /entities/test-plans/schema` reported
    `searchFields: []` — which is exactly what `EntityTable.tsx`'s `showSearch`
    gate keys off, so the admin list rendered no search box, and `?q=` would
    have been ignored even if it had.

    Per the TC's own fixture: the distinctive term lives in **`approach`** — the
    third of the five configured columns, not the first — so this also proves
    the `OR`-join reaches past the leading column.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    test_plan_ids: list = []
    try:
        needle = _needle("approach")
        async with AsyncSessionLocal() as session:
            from app.models.planning import TestPlan

            admin, org = await _create_org_admin(session, "s1a")
            project = await _create_project(session, org, "s1a")
            matching = TestPlan(
                project_id=project.id,
                identifier=f"TP-MATCH-{uuid4().hex[:8]}",  # needle NOT in identifier
                approach=f"risk-based, {needle}, exploratory",
                created_by_actor_id=admin.actor_id,
            )
            # Matches the term in none of its five configured columns.
            other = TestPlan(
                project_id=project.id,
                identifier=f"TP-OTHER-{uuid4().hex[:8]}",
                approach="plain approach text",
                scope="unrelated scope",
                created_by_actor_id=admin.actor_id,
            )
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            test_plan_ids = [matching.id, other.id]
            token = _access_token_for(admin.actor_id)
            proj_id, match_id, other_id = project.id, matching.id, other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"project_id": str(proj_id)}

            # The `?q=`-omitted call is the TC's own comparison baseline: it
            # establishes that BOTH rows are reachable, so the filtering below
            # is the search doing work rather than a one-row fixture.
            unfiltered = _ids(await _list(client, "/test-plans", token, scope))
            assert {str(match_id), str(other_id)} <= unfiltered

            found = _ids(await _list(client, "/test-plans", token, {**scope, "q": needle}))
            assert str(match_id) in found, "the plan whose `approach` holds the term must match"
            assert str(other_id) not in found, (
                "the non-matching plan must be ABSENT — asserting only the match's presence "
                "would pass identically against the pre-ADR-0070 silently-ignored-`?q=` bug"
            )
            assert found < unfiltered, "the searched list must be a strict subset of the un-searched one"
    finally:
        await _cleanup(
            user_ids=user_ids, org_ids=org_ids, project_ids=project_ids, test_plan_ids=test_plan_ids
        )


# --- TC-ADMIN-045: numeric search matches via cast-to-text, and actually filters ------------------


@pytest.mark.asyncio
async def test_numeric_search_matches_via_cast_and_filters() -> None:  # TC-ADMIN-045
    """TC-ADMIN-045. Fixture is the TC's own: sequences 1, 2, 10, 21.

    Match half (`q=2`): the step at sequence 2 is returned. Non-match half
    (`q=77`, a digit string matching no seeded sequence): **200 with an empty
    result set** — the load-bearing half, because pre-ADR-0070 *both* halves
    500'd identically with `ProgrammingError: operator does not exist:
    integer ~~* unknown`, so a match-only assertion could not tell a working
    cast from a broken one.
    """
    ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org, project, requirement, condition, level, type_, case, steps = (
                await _seed_case_with_steps(session, "s1d", [1, 2, 10, 21])
            )
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "requirement_ids": [requirement.id],
                "test_condition_ids": [condition.id],
                "test_case_ids": [case.id],
                "test_step_ids": [s.id for s in steps],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
            }
            token = _access_token_for(admin.actor_id)
            case_id = case.id
            by_seq = {s.sequence: str(s.id) for s in steps}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"test_case_id": str(case_id)}

            all_steps = _ids(await _list(client, "/test-steps", token, scope))
            assert len(all_steps) == 4, "fixture sanity: four steps before any filtering"

            # Match half. `2` also appears in `21`'s digits (substring
            # semantics, pinned by TC-ADMIN-046) — asserting the exact set
            # rather than mere membership keeps this honest about that.
            found = _ids(await _list(client, "/test-steps", token, {**scope, "q": "2"}))
            assert by_seq[2] in found, "the step at sequence 2 must be returned"
            assert found == {by_seq[2], by_seq[21]}, "`2` matches sequences 2 and 21, nothing else"

            # Non-match half: a clean empty set, NOT a 500. `_list` already
            # asserts the 200, which is itself half the claim.
            missing = await _list(client, "/test-steps", token, {"test_case_id": str(case_id), "q": "77"})
            assert missing["items"] == [], "no seeded sequence renders `77`"
            assert missing["total"] == 0
    finally:
        await _cleanup(**ids)


# --- TC-ADMIN-046: numeric semantics are substring-on-rendered-digits ------------------------------


@pytest.mark.asyncio
async def test_numeric_search_is_substring_on_rendered_digits_not_exact_match() -> None:  # TC-ADMIN-046
    """TC-ADMIN-046. Same 1/2/10/21 fixture. `q=1` must return sequences 1, 10
    **and** 21 (each rendering a `1`), and must NOT return sequence 2.

    This is the row that pins ADR-0070's rejected exact-match-on-numeric
    alternative: an exact-match implementation would return only sequence 1 and
    would still pass TC-ADMIN-045 unchanged. If numeric semantics are ever
    changed deliberately, this test is the one that must be updated with it.
    """
    ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org, project, requirement, condition, level, type_, case, steps = (
                await _seed_case_with_steps(session, "s1e", [1, 2, 10, 21])
            )
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "requirement_ids": [requirement.id],
                "test_condition_ids": [condition.id],
                "test_case_ids": [case.id],
                "test_step_ids": [s.id for s in steps],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
            }
            token = _access_token_for(admin.actor_id)
            case_id = case.id
            by_seq = {s.sequence: str(s.id) for s in steps}

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            found = _ids(
                await _list(client, "/test-steps", token, {"test_case_id": str(case_id), "q": "1"})
            )
            assert found == {by_seq[1], by_seq[10], by_seq[21]}, (
                "substring-on-digits: `1` matches sequences 1, 10 and 21"
            )
            assert by_seq[2] not in found, "sequence 2 renders no `1` digit and must be absent"
    finally:
        await _cleanup(**ids)


# --- TC-ADMIN-013 (corrected fixture): `?q=` still ignored where unconfigured ---------------------


@pytest.mark.asyncio
async def test_q_is_silently_ignored_for_test_log_which_has_no_search_fields() -> None:  # TC-ADMIN-013
    """TC-ADMIN-013's corrected negative half. ADR-0022's opt-in contract
    survives ADR-0070 unchanged: `TestLog` has a real generic `list` route and
    structurally zero free-text columns (every column is FK/UUID/enum/
    timestamp, its only payload a JSONB blob), so `?q=` must be a silent no-op
    — **the same result as omitting it**, not a 422 and not an empty list.

    The TC originally used `TestSuite` as its negative fixture; this story's own
    audit gave `TestSuite` `("name", "purpose")`, making that row factually
    wrong rather than merely stale.

    Real `TestLog` rows are seeded deliberately: with an empty table both the
    searched and un-searched calls return `[]` and the assertion would hold no
    matter what the code did — a vacuous test of exactly the shape
    `backend/CLAUDE.md`'s Alembic-idempotency note warns about.
    """
    from tests.integration.test_plan3_test_cycle_execution import (
        _cleanup as _plan3_cleanup,
    )
    from tests.integration.test_plan3_test_cycle_execution import (
        _create_condition_path_test_case,
        _create_environment,
        _create_org_admin as _plan3_org_admin,
        _create_project as _plan3_project,
        _create_release,
        _create_requirement as _plan3_requirement,
        _create_test_condition as _plan3_condition,
        _create_test_cycle,
        _create_test_execution,
        _create_test_level,
        _create_test_plan,
        _create_test_type,
    )

    ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _plan3_org_admin(session, "s1f")
            project = await _plan3_project(session, org, "s1f")
            requirement = await _plan3_requirement(session, project, "s1f")
            condition = await _plan3_condition(session, requirement, "s1f")
            level = await _create_test_level(session, "s1f")
            type_ = await _create_test_type(session, "s1f")
            case = await _create_condition_path_test_case(
                session,
                condition=condition,
                actor_id=admin.actor_id,
                test_level=level,
                test_type=type_,
                tag="s1f",
            )
            plan = await _create_test_plan(session, project, admin.actor_id, "s1f")
            release = await _create_release(session, project, "s1f")
            environment = await _create_environment(session, project, "s1f")
            cycle = await _create_test_cycle(
                session, plan=plan, release=release, environment=environment, tag="s1f"
            )
            execution = await _create_test_execution(session, cycle, case, admin.actor_id, "s1f")
            session.add_all(
                [
                    TestLog(
                        test_execution_id=execution.id,
                        event_type=TestLogEventType.comment,
                        payload={"comment": f"search1 seeded log {n}"},
                    )
                    for n in range(2)
                ]
            )
            await session.flush()
            await session.commit()
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "requirement_ids": [requirement.id],
                "test_condition_ids": [condition.id],
                "test_case_ids": [case.id],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
                "test_plan_ids": [plan.id],
            }
            token = _access_token_for(admin.actor_id)
            execution_id = execution.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"test_execution_id": str(execution_id)}
            without_q = await _list(client, "/test-logs", token, scope)
            with_q = await _list(client, "/test-logs", token, {**scope, "q": f"IGNORED-{uuid4().hex[:8]}"})

            assert without_q["total"] >= 2, "fixture sanity: the seeded logs must be visible"
            assert _ids(with_q) == _ids(without_q), "`?q=` must be a no-op, returning the same rows"
            assert with_q["total"] == without_q["total"]
    finally:
        await _plan3_cleanup(**ids)


# --- Supplementary coverage (no TC of its own — see module docstring) -----------------------------


@pytest.mark.asyncio
async def test_string_search_is_case_insensitive() -> None:
    """Not a TC row of its own: `ILIKE`-not-`LIKE` is asserted end-to-end here
    because the unit tests compile under the generic dialect, where `.ilike()`
    renders as `lower(x) LIKE ...` and therefore cannot prove real Postgres
    case-insensitivity for the newly-searchable entities."""
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    suite_ids: list = []
    try:
        needle = _needle("case").upper()
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "s1c")
            project = await _create_project(session, org, "s1c")
            suite = TestSuite(project_id=project.id, name=f"suite {needle}", purpose="smoke")
            session.add(suite)
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            suite_ids = [suite.id]
            token = _access_token_for(admin.actor_id)
            proj_id, suite_id = project.id, suite.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            lower = await _list(
                client, "/test-suites", token, {"project_id": str(proj_id), "q": needle.lower()}
            )
            assert str(suite_id) in _ids(lower), "a lowercased query must match an uppercase value"
    finally:
        # Child-first: `TestSuite` FKs `project`, and `_cleanup` deletes the
        # project, so these must go first or the project DELETE FK-violates.
        async with AsyncSessionLocal() as session:
            if suite_ids:
                await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
                await session.commit()
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_second_column_of_a_two_column_tuple_also_matches() -> None:
    """Not a TC row of its own. `Environment`'s tuple is `("name",
    "config_notes")`; a term present only in `config_notes` must still match."""
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    env_ids: list = []
    try:
        notes_needle = _needle("envnotes")
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "s1b")
            project = await _create_project(session, org, "s1b")
            matching = Environment(
                project_id=project.id,
                name=f"env-plain-{uuid4().hex[:8]}",  # needle NOT in name
                config_notes=f"staging box, {notes_needle}, 8GB",
            )
            other = Environment(
                project_id=project.id,
                name=f"env-other-{uuid4().hex[:8]}",
                config_notes="nothing relevant here",
            )
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            project_ids = [project.id]
            env_ids = [matching.id, other.id]
            token = _access_token_for(admin.actor_id)
            proj_id, match_id, other_id = project.id, matching.id, other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            found = _ids(
                await _list(
                    client, "/environments", token, {"project_id": str(proj_id), "q": notes_needle}
                )
            )
            assert found == {str(match_id)}, "a second-column match must still be found"
            assert str(other_id) not in found
    finally:
        async with AsyncSessionLocal() as session:
            if env_ids:
                await session.execute(delete(Environment).where(Environment.id.in_(env_ids)))
                await session.commit()
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_entity_schema_advertises_the_new_search_fields() -> None:
    """Not a TC row of its own. `GET /entities/{resource}/schema`'s
    `searchFields` is what the frontend's `showSearch` gate reads (ADR-0055) —
    the original bug was *visible* there as `searchFields: []` for
    `test-plans`, so the fix has to be observable there too, not only in query
    results. Also pins that the numeric column is advertised like any other."""
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "s1g")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            headers = {"Authorization": f"Bearer {token}"}

            plan_schema = await client.get(f"{API_PREFIX}/entities/test-plans/schema", headers=headers)
            assert plan_schema.status_code == 200
            assert plan_schema.json()["searchFields"] == [
                "identifier",
                "scope",
                "approach",
                "staffing_and_training",
                "schedule",
            ]

            step_schema = await client.get(f"{API_PREFIX}/entities/test-steps/schema", headers=headers)
            assert step_schema.status_code == 200
            assert step_schema.json()["searchFields"] == ["action", "expected_result", "sequence"]

            log_schema = await client.get(f"{API_PREFIX}/entities/test-logs/schema", headers=headers)
            assert log_schema.status_code == 200
            assert log_schema.json()["searchFields"] == [], "TC-ADMIN-013's negative fixture"
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)
