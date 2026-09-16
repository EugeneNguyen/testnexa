"""Integration tests for ADR-0072 (ENTITY-FILTER-1) — derived `filter_fields`
plus per-column filter-value coercion.

Real HTTP against a live server (`TEST_API_BASE_URL`), reusing
`test_admin2_crud.py`'s seeding/cleanup helpers — the cross-module import
precedent `test_admin2_execution_trace.py`/`test_search1_search_fields.py`
already established. The package-level `tests/integration/conftest.py`
skip-guard applies, so this module skips cleanly with no stack up.

Two claims are under test, and they failed *differently* before this ADR:

1. **Coverage.** Only 7 of 27 `CrudEntityConfig`s declared a `filter_fields`
   tuple, so `?<field>=<value>` was silently ignored on the other 20 — and
   even on those 7 it was ignored for every column outside the hand-written
   tuple. The failure mode was a *wrong result set*, never an error: `GET
   /test-suites?project_id=X&name=Y` returned 200 with every row. Every
   filtering test here therefore asserts the non-matching row is **absent**
   and compares against the same call with the filter omitted — a
   presence-only assertion passes identically against the bug.

2. **Safety.** The 7 pre-existing tuples happened to name only `String`/enum
   columns, where handing Postgres the raw query string is accidentally
   correct. Derived across all 27 entities the set now reaches `uuid`,
   `timestamptz`, `date`, `integer` and enum columns, where a malformed value
   is a DB-level error surfacing as a **500**. `coerce_filter_value` turns
   those into a `422` with an API Document §1 `field_errors` body. These tests
   prove what the unit tests structurally cannot: the coercion yields a
   *runnable* statement against real Postgres, and the rejection path is
   reached before the query is ever executed.

`TestCase` is the primary fixture because it is the one entity exercising
every branch at once: an enum column (`status`), two FK `uuid` columns
(`test_level_id`/`test_type_id`), a bounded `String` (`title`, **newly**
filterable — it was absent from the old hand-written tuple), and both flavours
of the free-text exclusion — `description` (the repo's only
`FieldMeta.long_text` field, deriving as `type: "text"`) and `preconditions`
(a plain `mapped_column(Text, ...)` with no `FieldMeta`, deriving as `type:
"string"`). That second flavour is the larger class by far — 16 `Text` columns
repo-wide against `long_text`'s one — and is why the exclusion is keyed on the
model column's own SQLAlchemy type rather than on `long_text` alone.
`TestSuite` stands in for the 20 entities that had no tuple at all.
"""

import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.assets import TestCase, TestCaseStatus, TestSuite
from tests.integration.test_admin2_crud import (
    _access_token_for,
    _cleanup,
    _create_org_admin,
    _create_project,
    _create_taxonomy_pair,
)

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"


def _needle(tag: str) -> str:
    """A token that cannot collide with any other row in a shared cloned DB."""
    return f"FILTER1-{tag}-{uuid4().hex[:10]}"


async def _list(client: httpx.AsyncClient, path: str, token: str, params: dict) -> dict:
    response = await client.get(
        f"{API_PREFIX}{path}", params=params, headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, f"{path} {params} -> {response.status_code}: {response.text}"
    return response.json()


async def _raw(client: httpx.AsyncClient, path: str, token: str, params: dict) -> httpx.Response:
    return await client.get(
        f"{API_PREFIX}{path}", params=params, headers={"Authorization": f"Bearer {token}"}
    )


def _ids(body: dict) -> set[str]:
    return {item["id"] for item in body["items"]}


async def _delete_test_suites(suite_ids: list) -> None:
    """`_cleanup` has no `TestSuite` leg and `TestSuite` FKs `project`, so its
    rows must go before the project DELETE — same child-first shape
    `test_search1_search_fields.py` uses for its own `TestSuite` fixture."""
    if not suite_ids:
        return
    async with AsyncSessionLocal() as session:
        await session.execute(delete(TestSuite).where(TestSuite.id.in_(suite_ids)))
        await session.commit()


# --- a real filter narrows a real list ------------------------------------------------------------


@pytest.mark.asyncio
async def test_filter_narrows_the_list_on_an_entity_that_had_no_filter_fields_at_all() -> None:
    """`TestSuite` is one of the 20 configs with no `filter_fields` tuple
    whatsoever, so `?name=` was a documented-but-invisible no-op: the list came
    back complete, with no error to signal why.

    The `?name=`-omitted call is the comparison baseline — it establishes that
    BOTH rows are reachable, so the filtering below is the filter doing work
    rather than a one-row fixture.
    """
    user_ids: list = []
    org_ids: list = []
    project_ids: list = []
    suite_ids: list = []
    try:
        wanted = _needle("suite-wanted")
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1a")
            project = await _create_project(session, org, "f1a")
            matching = TestSuite(project_id=project.id, name=wanted, purpose="smoke")
            other = TestSuite(project_id=project.id, name=_needle("suite-other"), purpose="smoke")
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            user_ids, org_ids, project_ids = [admin.actor_id], [org.id], [project.id]
            suite_ids = [matching.id, other.id]
            token = _access_token_for(admin.actor_id)
            proj_id, match_id, other_id = project.id, matching.id, other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"project_id": str(proj_id)}

            unfiltered = _ids(await _list(client, "/test-suites", token, scope))
            assert {str(match_id), str(other_id)} <= unfiltered, "fixture sanity: both suites are reachable"

            found = _ids(await _list(client, "/test-suites", token, {**scope, "name": wanted}))
            assert str(match_id) in found, "the suite whose `name` matches exactly must be returned"
            assert str(other_id) not in found, (
                "the non-matching suite must be ABSENT — asserting only the match's presence "
                "would pass identically against the pre-ADR-0072 silently-ignored-filter bug"
            )
            assert found < unfiltered, "the filtered list must be a strict subset of the unfiltered one"
    finally:
        await _delete_test_suites(suite_ids)
        await _cleanup(user_ids=user_ids, org_ids=org_ids, project_ids=project_ids)


@pytest.mark.asyncio
async def test_filter_narrows_on_a_column_outside_the_old_hand_written_tuple() -> None:
    """`TestCase`'s deleted tuple was `("status", "test_level_id",
    "test_type_id")` — `title` was NOT in it, so filtering by title was
    ignored even on one of the 7 entities that "had filtering". This is the
    per-column half of the same coverage gap the previous test shows
    per-entity.
    """
    ids: dict = {}
    try:
        wanted = _needle("title")
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1b")
            project = await _create_project(session, org, "f1b")
            level, type_ = await _create_taxonomy_pair(session, "f1b")
            matching = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                created_by_actor_id=admin.actor_id,
                title=wanted,
            )
            other = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                created_by_actor_id=admin.actor_id,
                title=_needle("title-other"),
            )
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "test_case_ids": [matching.id, other.id],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
            }
            token = _access_token_for(admin.actor_id)
            proj_id, match_id, other_id = project.id, matching.id, other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"project_id": str(proj_id)}

            unfiltered = _ids(await _list(client, "/test-cases", token, scope))
            assert {str(match_id), str(other_id)} <= unfiltered

            found = _ids(await _list(client, "/test-cases", token, {**scope, "title": wanted}))
            assert found == {str(match_id)}
            assert str(other_id) not in found
    finally:
        await _cleanup(**ids)


# --- two filters AND together ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_filters_and_together_rather_than_or() -> None:
    """Three rows across a 2x2 of (`status`, `test_level_id`): only the row
    matching BOTH is returned. Each single-filter call is asserted too, so a
    regression to `OR` (or to "last filter wins") cannot hide behind a fixture
    where the two predicates happen to select the same row.
    """
    ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1c")
            project = await _create_project(session, org, "f1c")
            level_a, type_ = await _create_taxonomy_pair(session, "f1c-a")
            level_b, type_b = await _create_taxonomy_pair(session, "f1c-b")

            def _case(*, level, status: TestCaseStatus, tag: str) -> TestCase:
                return TestCase(
                    project_id=project.id,
                    test_level_id=level.id,
                    test_type_id=type_.id,
                    created_by_actor_id=admin.actor_id,
                    title=_needle(tag),
                    status=status,
                )

            both = _case(level=level_a, status=TestCaseStatus.approved, tag="both")
            status_only = _case(level=level_b, status=TestCaseStatus.approved, tag="status-only")
            level_only = _case(level=level_a, status=TestCaseStatus.draft, tag="level-only")
            session.add_all([both, status_only, level_only])
            await session.flush()
            await session.commit()
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "test_case_ids": [both.id, status_only.id, level_only.id],
                "test_level_ids": [level_a.id, level_b.id],
                "test_type_ids": [type_.id, type_b.id],
            }
            token = _access_token_for(admin.actor_id)
            proj_id, level_a_id = project.id, level_a.id
            both_id, status_only_id, level_only_id = both.id, status_only.id, level_only.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"project_id": str(proj_id)}

            # Each predicate alone selects a DIFFERENT two-row set...
            by_status = _ids(await _list(client, "/test-cases", token, {**scope, "status": "approved"}))
            assert by_status == {str(both_id), str(status_only_id)}

            by_level = _ids(
                await _list(client, "/test-cases", token, {**scope, "test_level_id": str(level_a_id)})
            )
            assert by_level == {str(both_id), str(level_only_id)}

            # ...so their conjunction is strictly smaller than either, and
            # their union (what an `OR` regression would return) is all three.
            both_filters = _ids(
                await _list(
                    client,
                    "/test-cases",
                    token,
                    {**scope, "status": "approved", "test_level_id": str(level_a_id)},
                )
            )
            assert both_filters == {str(both_id)}, "two filters must AND, not OR"
            assert str(status_only_id) not in both_filters
            assert str(level_only_id) not in both_filters
    finally:
        await _cleanup(**ids)


# --- malformed values are 422, never 500 ----------------------------------------------------------


@pytest.mark.asyncio
async def test_malformed_filter_values_return_422_not_500() -> None:
    """The safety half of ADR-0072. Each of these hands Postgres a value its
    column's type cannot accept; without `coerce_filter_value` the request
    reaches the driver and comes back a 500 (`invalid input syntax for type
    uuid`, `invalid input value for enum test_case_status`).

    The 422 body is asserted key-by-key against API Document §1 — the same
    envelope the pre-existing `?sort=<unsortable>` rejection already uses, with
    `field_errors` keyed by the offending query param (which, for a filter,
    IS the column name).
    """
    ids: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1d")
            project = await _create_project(session, org, "f1d")
            level, type_ = await _create_taxonomy_pair(session, "f1d")
            case = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                created_by_actor_id=admin.actor_id,
                title=_needle("malformed"),
            )
            session.add(case)
            await session.flush()
            await session.commit()
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "test_case_ids": [case.id],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
            }
            token = _access_token_for(admin.actor_id)
            proj_id = project.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            scope = {"project_id": str(proj_id)}

            for bad_field, bad_value in (
                ("test_level_id", "not-a-uuid"),  # Uuid column
                ("status", "definitely-not-a-status"),  # Enum column
            ):
                response = await _raw(client, "/test-cases", token, {**scope, bad_field: bad_value})
                assert response.status_code == 422, (
                    f"{bad_field}={bad_value!r} -> {response.status_code}: {response.text} "
                    "(a 500 here means the value reached Postgres un-coerced)"
                )
                body = response.json()
                assert body["code"] == "validation_error"
                assert body["message"] == "Request failed validation."
                assert bad_field in body["field_errors"], body["field_errors"]
                assert body["field_errors"][bad_field], "the field's error list must not be empty"

            # A well-formed but non-matching value is NOT an error — it is an
            # empty result. This is what distinguishes "rejected the input"
            # from "rejected everything".
            empty = await _list(
                client, "/test-cases", token, {**scope, "test_level_id": str(uuid4())}
            )
            assert empty["items"] == []
            assert empty["total"] == 0
    finally:
        await _cleanup(**ids)


# --- a `text`-typed column is not filterable ------------------------------------------------------


@pytest.mark.asyncio
async def test_text_typed_fields_are_not_filterable() -> None:
    """Both markers of "unbounded free text", on one entity:

    - **`description`** — the repo's ONLY `FieldMeta.long_text` field, so its
      derived `type` is `"text"`.
    - **`preconditions`** — a plain `mapped_column(Text, ...)` with no
      `FieldMeta` at all, deriving as `type: "string"`. This is the far larger
      class (16 `Text` columns repo-wide against `long_text`'s one), and the
      one a `long_text`-only rule would have silently offered as a filter.

    Both are absent from `filterFields`, both carry `filterable: false`, and
    both are a **no-op** as a query param — the same posture ADR-0022 gives an
    unconfigured `?q=`, NOT a 422 (an unrecognised query param has always been
    ignored on these routes; 422-ing one would break `page`/`page_size`/
    `sort`/`q` and every scope param alike).

    Exact equality on an unbounded free-text column answers no question worth
    asking; `?q=` (ADR-0070) is the tool for those columns, and this test pins
    that the exclusion is real rather than merely documented.
    """
    ids: dict = {}
    try:
        wanted_description = _needle("description")
        wanted_preconditions = _needle("preconditions")
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1e")
            project = await _create_project(session, org, "f1e")
            level, type_ = await _create_taxonomy_pair(session, "f1e")
            matching = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                created_by_actor_id=admin.actor_id,
                title=_needle("desc-match"),
                description=wanted_description,
                preconditions=wanted_preconditions,
            )
            other = TestCase(
                project_id=project.id,
                test_level_id=level.id,
                test_type_id=type_.id,
                created_by_actor_id=admin.actor_id,
                title=_needle("desc-other"),
                description="something else entirely",
                preconditions="unrelated preconditions",
            )
            session.add_all([matching, other])
            await session.flush()
            await session.commit()
            ids = {
                "user_ids": [admin.actor_id],
                "org_ids": [org.id],
                "project_ids": [project.id],
                "test_case_ids": [matching.id, other.id],
                "test_level_ids": [level.id],
                "test_type_ids": [type_.id],
            }
            token = _access_token_for(admin.actor_id)
            proj_id, match_id, other_id = project.id, matching.id, other.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            headers = {"Authorization": f"Bearer {token}"}
            scope = {"project_id": str(proj_id)}

            schema = (await client.get(f"{API_PREFIX}/entities/test-cases/schema", headers=headers)).json()
            fields = {f["name"]: f for f in schema["fields"]}

            for name in ("description", "preconditions"):
                assert name not in schema["filterFields"], (
                    f"`{name}` is an unbounded free-text column and must never be advertised as "
                    "filterable — this is what the frontend's filter control reads to decide "
                    "which columns to offer"
                )
                assert fields[name]["filterable"] is False

            # The two are excluded for DIFFERENT reasons, and the served
            # `type` proves it: only `long_text` promotes the type, so a rule
            # keyed on `type == "text"` alone would have let `preconditions`
            # through.
            assert fields["description"]["type"] == "text", "`long_text` promotes the derived type"
            assert fields["preconditions"]["type"] == "string", (
                "a plain `Text` column derives as `string` — its exclusion comes from the model "
                "column's own SQLAlchemy type, not from the derived field type"
            )

            # ...and the route agrees with its own schema: each param is
            # ignored rather than narrowing anything.
            without = await _list(client, "/test-cases", token, scope)
            assert _ids(without) == {str(match_id), str(other_id)}
            for param, value in (
                ("description", wanted_description),
                ("preconditions", wanted_preconditions),
            ):
                with_param = await _list(client, "/test-cases", token, {**scope, param: value})
                assert _ids(with_param) == _ids(without), f"`?{param}=` must be a no-op"
                assert with_param["total"] == without["total"]
    finally:
        await _cleanup(**ids)


# --- the org-scoping boundary survives filtering --------------------------------------------------


@pytest.mark.asyncio
async def test_filtering_does_not_break_the_org_scoping_boundary() -> None:
    """NFR-1 (ADR-0007): cross-tenant access is a `404`, never a `403` and
    never a leak. Two independent orgs, each with a project and one `TestCase`
    carrying a globally-unique title.

    Three distinct ways a widened filter surface could have broken the
    boundary, all asserted:

    1. Filtering another org's project `404`s at the scope gate — the filter
       must not create a second, ungated entry point into the query.
    2. Filtering *within* one's own org by a value that only exists in the
       other org returns empty — the filter is `AND`ed onto the org-scoped
       query, never `OR`ed alongside it.
    3. A `404` for org B's project is byte-identical whether a filter is
       present or not — the response must not become distinguishable (a
       `403`, or a different body) and thereby confirm the row's existence.
    """
    ids_a: dict = {}
    ids_b: dict = {}
    try:
        async with AsyncSessionLocal() as session:
            admin_a, org_a = await _create_org_admin(session, "f1f-a")
            project_a = await _create_project(session, org_a, "f1f-a")
            level_a, type_a = await _create_taxonomy_pair(session, "f1f-a")
            title_a = _needle("org-a")
            case_a = TestCase(
                project_id=project_a.id,
                test_level_id=level_a.id,
                test_type_id=type_a.id,
                created_by_actor_id=admin_a.actor_id,
                title=title_a,
            )

            admin_b, org_b = await _create_org_admin(session, "f1f-b")
            project_b = await _create_project(session, org_b, "f1f-b")
            level_b, type_b = await _create_taxonomy_pair(session, "f1f-b")
            title_b = _needle("org-b")
            case_b = TestCase(
                project_id=project_b.id,
                test_level_id=level_b.id,
                test_type_id=type_b.id,
                created_by_actor_id=admin_b.actor_id,
                title=title_b,
            )
            session.add_all([case_a, case_b])
            await session.flush()
            await session.commit()

            ids_a = {
                "user_ids": [admin_a.actor_id],
                "org_ids": [org_a.id],
                "project_ids": [project_a.id],
                "test_case_ids": [case_a.id],
                "test_level_ids": [level_a.id],
                "test_type_ids": [type_a.id],
            }
            ids_b = {
                "user_ids": [admin_b.actor_id],
                "org_ids": [org_b.id],
                "project_ids": [project_b.id],
                "test_case_ids": [case_b.id],
                "test_level_ids": [level_b.id],
                "test_type_ids": [type_b.id],
            }
            token_a = _access_token_for(admin_a.actor_id)
            proj_a_id, proj_b_id = project_a.id, project_b.id
            case_a_id, case_b_id = case_a.id, case_b.id
            level_b_id = level_b.id

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            # 1. Org A's admin, filtering org B's project.
            cross = await _raw(
                client, "/test-cases", token_a, {"project_id": str(proj_b_id), "title": title_b}
            )
            assert cross.status_code == 404, cross.text
            assert cross.json()["code"] == "not_found", "NFR-1: 404, never 403, across an org boundary"

            # 3. ...and identical to the unfiltered cross-tenant call, so the
            #    filter's presence leaks nothing about whether it matched.
            cross_unfiltered = await _raw(client, "/test-cases", token_a, {"project_id": str(proj_b_id)})
            assert cross_unfiltered.status_code == 404
            assert cross_unfiltered.json() == cross.json()

            # 2. Within org A, filtering by values that exist only in org B.
            own_scope = {"project_id": str(proj_a_id)}
            assert _ids(await _list(client, "/test-cases", token_a, own_scope)) == {str(case_a_id)}

            by_foreign_title = await _list(client, "/test-cases", token_a, {**own_scope, "title": title_b})
            assert by_foreign_title["items"] == [], "org B's row must be unreachable via a filter value"
            assert str(case_b_id) not in _ids(by_foreign_title)

            by_foreign_level = await _list(
                client, "/test-cases", token_a, {**own_scope, "test_level_id": str(level_b_id)}
            )
            assert by_foreign_level["items"] == []
    finally:
        await _cleanup(**ids_a)
        await _cleanup(**ids_b)


# --- the served schema advertises the derived set -------------------------------------------------


@pytest.mark.asyncio
async def test_entity_schema_advertises_the_derived_filter_fields() -> None:
    """`GET /entities/{resource}/schema`'s `filterFields` is what the admin
    surface reads to decide which columns get a filter control — so the
    derivation has to be observable there, not only in query results.

    `test-suites` is the "had no tuple at all" case (`[]` before this ADR);
    `test-cases` is the "had a tuple, but a partial one" case, asserted as an
    exact list so both the newly-included columns and the excluded `long_text`
    one are pinned in one assertion.
    """
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "f1g")
            await session.commit()
            user_ids, org_ids = [admin.actor_id], [org.id]
            token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            headers = {"Authorization": f"Bearer {token}"}

            suites = (await client.get(f"{API_PREFIX}/entities/test-suites/schema", headers=headers)).json()
            assert suites["filterFields"] == ["project_id", "name", "purpose"], (
                "an entity that never declared `filter_fields` now derives its full set"
            )

            cases = (await client.get(f"{API_PREFIX}/entities/test-cases/schema", headers=headers)).json()
            assert cases["filterFields"] == [
                "project_id",
                "test_condition_id",
                "test_level_id",
                "test_type_id",
                # `title` is a bounded `String` — newly filterable, and absent
                # from the deleted hand-written tuple.
                "title",
                # `description` (long_text AND Text), `preconditions` and
                # `expected_result` (Text, no `FieldMeta` at all) are all
                # deliberately absent — unbounded free text.
                "status",
                "created_by_actor_id",
            ]

            # `TestLog.payload` (`JSONB`) is the third exclusion category:
            # equality compares the whole document, so the only matching input
            # is a byte-exact re-serialization of it. Unlike a bad UUID this
            # never errors — it is a silent always-empty filter — which is why
            # it must not be offered rather than merely coerced.
            logs = (await client.get(f"{API_PREFIX}/entities/test-logs/schema", headers=headers)).json()
            # ADR-0079 Amendment 1 (2026-09-16) added `create_schema` to
            # `_TEST_LOG_CONFIG` for the compound-create form — `attachment_url`/
            # `file_name` (plain strings) joined the filterable set; `text`
            # (also new) is excluded by the SAME `long_text` rule this file's
            # own `description`/`preconditions` exclusions above already cover.
            assert logs["filterFields"] == [
                "test_execution_id",
                "attachment_url",
                "file_name",
                "event_type",
                "logged_at",
            ]
            assert next(f for f in logs["fields"] if f["name"] == "payload")["filterable"] is False

            # The invariant that keeps the route and the schema honest: the
            # served list is exactly the fields flagged filterable.
            for body in (suites, cases, logs):
                assert body["filterFields"] == [f["name"] for f in body["fields"] if f["filterable"]]
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)
