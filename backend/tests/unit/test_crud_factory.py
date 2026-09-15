"""Unit tests for `app/api/crud_factory.py` (API-1, ADR-0022).

Pure in-process tests: no DB, no live server, no network — mirrors
`tests/unit/test_rbac.py`'s "hand-rolled fake session" convention (that
module's own docstring explains why: no existing unit test establishes a
DB-mocking library convention, so a fake limited to exactly the surface under
test is used instead). Covers exactly what CLAUDE.md's unit/integration split
calls "plain branching logic" territory:

- `chain_resolver`'s hop-walking logic (`db.get` mocked via `_FakeSession`),
  including the bespoke `TestCase`/`RiskItem`/`Organization`/global-catalog
  resolvers.
- Query-param -> filter/search clause translation (`apply_filters_and_search`)
  — built against real ORM model classes (`Requirement`), since constructing
  a `select()`/`.where()` expression is pure Core-object-building, never
  touches a DB.
- Scope-value extraction/validation (`extract_scope_value`/
  `scope_validation_error`), including `RiskItem`'s tuple-`scope_field`
  "exactly one" rule.
- Pagination clamping (`clamp_pagination`).
- Path/display-name helpers (`_resource_path`/`_display_name`).

Deliberately NOT covered here (integration-test territory instead, same
posture `app/core/rbac.py`'s own docstring establishes for `has_permission`/
`has_permission_in_any_org`): anything that calls those two functions, since
both always open their own real `AsyncSessionLocal` session regardless of
what `db` a route was given — verified directly during this story's manual
smoke-testing (a mocked `get_db` override does NOT intercept them), so no
amount of route-level DB mocking can unit-test a path through either.
"""

import uuid
from typing import Any, Literal

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app.api.crud_factory import (
    CrudEntityConfig,
    FieldMeta,
    _display_name,
    _resource_path,
    _search_clause,
    apply_filters_and_search,
    apply_sort,
    chain_resolver,
    clamp_pagination,
    coerce_filter_value,
    derive_entity_schema,
    extract_scope_value,
    resolve_global_org_id,
    resolve_organization_org_id,
    resolve_risk_item_org_id,
    resolve_terminal_org_id,
    resolve_test_case_org_id,
    resolve_via_test_case,
    scope_validation_error,
)
from app.models.assets import Requirement, TestCase, TestCondition, TestStep, TestSuite
from app.models.execution import Defect
from app.models.governance import Attachment, RiskItem
from app.models.planning import TestCycle, TestPlan
from app.models.project import Project
from app.models.rbac import Role
from app.models.tenancy import Organization


class _FakeSession:
    """Minimal `db.get`/`db.scalar` fake — just enough surface for `resolve_org_id` functions.

    `_rows` is `{(model, pk): row_or_None}`; `.get()` returns `None` for any
    key not registered (matches a real `AsyncSession.get()` on a missing
    row). `.scalar()` calls are answered from `scalar_results` in order (only
    `resolve_test_case_org_id`'s `RequirementTestCaseLink`/`TestSuiteTestCase`
    link lookups call it, up to two calls per resolution since REQ-2 added
    the requirement-link fallback) — once exhausted, further calls repeat the
    single `scalar_result` value, so single-`.scalar()`-call tests can keep
    passing just that one canned answer.
    """

    def __init__(
        self,
        rows: dict[tuple[type, Any], Any] | None = None,
        scalar_result: Any = None,
        scalar_results: list[Any] | None = None,
    ) -> None:
        self._rows = rows or {}
        self._scalar_result = scalar_result
        self._scalar_results = list(scalar_results) if scalar_results is not None else None

    async def get(self, model: type, pk: Any) -> Any:
        return self._rows.get((model, pk))

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        if self._scalar_results:
            return self._scalar_results.pop(0)
        return self._scalar_result


def _row(**attrs: Any) -> Any:
    """Build a bare object exposing exactly the given attributes (like a fetched ORM row)."""

    class _Row:
        pass

    r = _Row()
    for key, value in attrs.items():
        setattr(r, key, value)
    return r


# --- resolve_terminal_org_id -------------------------------------------------------------------


class TestResolveTerminalOrgId:
    async def test_row_with_org_id_returns_it_directly(self) -> None:
        org_id = uuid.uuid4()
        row = _row(org_id=org_id)
        db = _FakeSession()
        assert await resolve_terminal_org_id(db, row) == org_id

    async def test_row_with_project_id_resolves_via_project(self) -> None:
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)
        row = _row(project_id=project_id)
        db = _FakeSession(rows={(Project, project_id): project})
        assert await resolve_terminal_org_id(db, row) == org_id

    async def test_row_with_neither_returns_none(self) -> None:
        row = _row()
        db = _FakeSession()
        assert await resolve_terminal_org_id(db, row) is None

    async def test_project_id_set_but_project_missing_returns_none(self) -> None:
        row = _row(project_id=uuid.uuid4())
        db = _FakeSession()
        assert await resolve_terminal_org_id(db, row) is None

    async def test_org_id_none_falls_through_to_project_id(self) -> None:
        """A row with `org_id=None` (present but null) must still try `project_id`."""
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)
        row = _row(org_id=None, project_id=project_id)
        db = _FakeSession(rows={(Project, project_id): project})
        assert await resolve_terminal_org_id(db, row) == org_id


# --- chain_resolver -----------------------------------------------------------------------------


class TestChainResolver:
    async def test_zero_hops_direct_org_id_column(self) -> None:
        """`Requirement`/`TestSuite`-style direct scope, but on an `org_id`-bearing row."""
        org_id = uuid.uuid4()
        resolver = chain_resolver([])
        row = _row(org_id=org_id)
        db = _FakeSession()
        assert await resolver(db, row) == org_id

    async def test_zero_hops_direct_project_id_column(self) -> None:
        """`Requirement`'s actual shape: no hops, terminal resolves `project_id` -> `Project.org_id`."""
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)
        resolver = chain_resolver([])
        row = _row(project_id=project_id)
        db = _FakeSession(rows={(Project, project_id): project})
        assert await resolver(db, row) == org_id

    async def test_one_hop_resolves_through_parent(self) -> None:
        """`TestCondition`'s shape: one hop to `Requirement`, then its `project_id`."""
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)
        resolver = chain_resolver([(Requirement, "requirement_id")])
        row = _row(requirement_id=requirement_id)
        db = _FakeSession(rows={(Requirement, requirement_id): requirement, (Project, project_id): project})
        assert await resolver(db, row) == org_id

    async def test_multi_hop_resolves_through_full_chain(self) -> None:
        """`Defect`'s 3-hop shape: `TestExecution` -> `TestCycle` -> `TestPlan` -> `Project`."""
        from app.models.execution import TestExecution

        test_execution_id = uuid.uuid4()
        test_cycle_id = uuid.uuid4()
        test_plan_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        execution = _row(test_cycle_id=test_cycle_id)
        cycle = _row(test_plan_id=test_plan_id)
        plan = _row(project_id=project_id)
        project = _row(org_id=org_id)

        resolver = chain_resolver(
            [
                (TestExecution, "test_execution_id"),
                (TestCycle, "test_cycle_id"),
                (TestPlan, "test_plan_id"),
            ]
        )
        row = _row(test_execution_id=test_execution_id)
        db = _FakeSession(
            rows={
                (TestExecution, test_execution_id): execution,
                (TestCycle, test_cycle_id): cycle,
                (TestPlan, test_plan_id): plan,
                (Project, project_id): project,
            }
        )
        assert await resolver(db, row) == org_id

    async def test_missing_fk_value_short_circuits_to_none(self) -> None:
        resolver = chain_resolver([(Requirement, "requirement_id")])
        row = _row(requirement_id=None)
        db = _FakeSession()
        assert await resolver(db, row) is None

    async def test_hop_target_not_found_short_circuits_to_none(self) -> None:
        resolver = chain_resolver([(Requirement, "requirement_id")])
        row = _row(requirement_id=uuid.uuid4())
        db = _FakeSession()  # empty — db.get() returns None for any key
        assert await resolver(db, row) is None

    async def test_works_against_a_simplenamespace_style_scope_standin(self) -> None:
        """List/create scope resolution passes a stand-in exposing only the one scope attribute."""
        import types

        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)
        resolver = chain_resolver([])
        standin = types.SimpleNamespace(project_id=project_id)
        db = _FakeSession(rows={(Project, project_id): project})
        assert await resolver(db, standin) == org_id


# --- resolve_test_case_org_id (bespoke) ---------------------------------------------------------


class TestResolveTestCaseOrgId:
    async def test_resolves_via_test_condition_when_set(self) -> None:
        test_condition_id = uuid.uuid4()
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        condition = _row(requirement_id=requirement_id)
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(id=uuid.uuid4(), test_condition_id=test_condition_id)
        db = _FakeSession(
            rows={
                (TestCondition, test_condition_id): condition,
                (Requirement, requirement_id): requirement,
                (Project, project_id): project,
            }
        )
        assert await resolve_test_case_org_id(db, row) == org_id

    async def test_falls_back_to_requirement_link_when_condition_unset(self) -> None:
        """REQ-2's direct-link path (ADR-0006) — first fallback checked, before `TestSuiteTestCase`."""
        from app.models.trace import RequirementTestCaseLink

        test_case_id = uuid.uuid4()
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        link = _row(requirement_id=requirement_id)
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(id=test_case_id, test_condition_id=None)
        db = _FakeSession(
            rows={(Requirement, requirement_id): requirement, (Project, project_id): project},
            # Only one `.scalar()` call expected: the `RequirementTestCaseLink`
            # lookup hits, so `TestSuiteTestCase` is never queried.
            scalar_results=[link],
        )
        assert await resolve_test_case_org_id(db, row) == org_id

    async def test_falls_back_to_test_suite_link_when_condition_and_requirement_link_unset(self) -> None:
        from app.models.assets import TestSuiteTestCase

        test_case_id = uuid.uuid4()
        test_suite_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        link = _row(test_suite_id=test_suite_id)
        suite = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(id=test_case_id, test_condition_id=None)
        db = _FakeSession(
            rows={(TestSuite, test_suite_id): suite, (Project, project_id): project},
            # First `.scalar()` (RequirementTestCaseLink) misses -> `None`;
            # second (TestSuiteTestCase) hits -> `link`.
            scalar_results=[None, link],
        )
        assert await resolve_test_case_org_id(db, row) == org_id

    async def test_orphaned_row_resolves_to_none(self) -> None:
        """No `test_condition_id`, no link of either kind -> unresolvable (ADR-0022 edge case #1)."""
        row = _row(id=uuid.uuid4(), test_condition_id=None)
        db = _FakeSession(scalar_result=None)
        assert await resolve_test_case_org_id(db, row) is None

    async def test_condition_set_but_missing_resolves_to_none(self) -> None:
        row = _row(id=uuid.uuid4(), test_condition_id=uuid.uuid4())
        db = _FakeSession()  # condition lookup misses
        assert await resolve_test_case_org_id(db, row) is None

    async def test_resolves_via_project_id_for_standalone_case(self) -> None:
        """REQ-5's standalone path (ADR-0069) — 3rd branch, no Requirement/TestCondition link at all."""
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)

        row = _row(id=uuid.uuid4(), test_condition_id=None, project_id=project_id)
        db = _FakeSession(
            rows={(Project, project_id): project},
            # Only one `.scalar()` call expected: the `RequirementTestCaseLink`
            # lookup misses, `project_id` resolves directly — `TestSuiteTestCase`
            # is never queried.
            scalar_results=[None],
        )
        assert await resolve_test_case_org_id(db, row) == org_id

    async def test_project_id_set_but_project_missing_resolves_to_none(self) -> None:
        row = _row(id=uuid.uuid4(), test_condition_id=None, project_id=uuid.uuid4())
        db = _FakeSession(scalar_results=[None])
        assert await resolve_test_case_org_id(db, row) is None

    async def test_requirement_link_takes_precedence_over_project_id(self) -> None:
        """A since-linked standalone case (`project_id` never cleared, ADR-0069)
        resolves via the more specific `RequirementTestCaseLink` branch."""
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        link_org_id = uuid.uuid4()
        stale_project_org_id = uuid.uuid4()

        link = _row(requirement_id=requirement_id)
        requirement = _row(project_id=project_id)
        # The linked Requirement's own Project resolves to `link_org_id`; the
        # TestCase's own (deliberately unchanged) `project_id` column would
        # resolve to a *different* org if it were ever consulted — proves the
        # branch order, not just that some org is returned.
        linked_project = _row(org_id=link_org_id)
        stale_project = _row(org_id=stale_project_org_id)

        row = _row(id=uuid.uuid4(), test_condition_id=None, project_id=project_id)
        db = _FakeSession(
            rows={
                (Requirement, requirement_id): requirement,
                (Project, project_id): linked_project,
            },
            scalar_results=[link],
        )
        assert await resolve_test_case_org_id(db, row) == link_org_id
        assert stale_project.org_id == stale_project_org_id  # sanity: fixture never consulted

    async def test_scope_resolution_stand_in_row_with_only_project_id(self) -> None:
        """`_resolve_scope_for_write`'s own `types.SimpleNamespace(project_id=...)`
        stand-in (no `.id` attribute at all) must resolve without erroring —
        the two link-table branches need a real row id and must be skipped,
        not short-circuit the whole resolution to `None` (ADR-0069)."""
        import types

        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        project = _row(org_id=org_id)

        row = types.SimpleNamespace(project_id=project_id)
        db = _FakeSession(rows={(Project, project_id): project})
        assert await resolve_test_case_org_id(db, row) == org_id


# --- resolve_via_test_case (TestStep/Attachment delegation) -------------------------------------


class TestResolveViaTestCase:
    async def test_delegates_to_test_case_resolver(self) -> None:
        test_case_id = uuid.uuid4()
        test_condition_id = uuid.uuid4()
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        test_case = _row(id=test_case_id, test_condition_id=test_condition_id)
        condition = _row(requirement_id=requirement_id)
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(test_case_id=test_case_id)
        db = _FakeSession(
            rows={
                (TestCase, test_case_id): test_case,
                (TestCondition, test_condition_id): condition,
                (Requirement, requirement_id): requirement,
                (Project, project_id): project,
            }
        )
        assert await resolve_via_test_case(db, row) == org_id

    async def test_missing_test_case_resolves_to_none(self) -> None:
        row = _row(test_case_id=uuid.uuid4())
        db = _FakeSession()
        assert await resolve_via_test_case(db, row) is None

    async def test_missing_fk_resolves_to_none(self) -> None:
        row = _row(test_case_id=None)
        db = _FakeSession()
        assert await resolve_via_test_case(db, row) is None


# --- resolve_risk_item_org_id (bespoke branching) ------------------------------------------------


class TestResolveRiskItemOrgId:
    async def test_branches_on_requirement_id_when_set(self) -> None:
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(requirement_id=requirement_id, test_plan_id=None)
        db = _FakeSession(rows={(Requirement, requirement_id): requirement, (Project, project_id): project})
        assert await resolve_risk_item_org_id(db, row) == org_id

    async def test_branches_on_test_plan_id_when_requirement_unset(self) -> None:
        test_plan_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        plan = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(requirement_id=None, test_plan_id=test_plan_id)
        db = _FakeSession(rows={(TestPlan, test_plan_id): plan, (Project, project_id): project})
        assert await resolve_risk_item_org_id(db, row) == org_id

    async def test_neither_set_resolves_to_none(self) -> None:
        row = _row(requirement_id=None, test_plan_id=None)
        db = _FakeSession()
        assert await resolve_risk_item_org_id(db, row) is None

    async def test_works_against_simplenamespace_with_only_one_attribute(self) -> None:
        """List/create scope resolution's stand-in only carries ONE of the two FK attributes."""
        import types

        test_plan_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()
        plan = _row(project_id=project_id)
        project = _row(org_id=org_id)

        standin = types.SimpleNamespace(test_plan_id=test_plan_id)
        db = _FakeSession(rows={(TestPlan, test_plan_id): plan, (Project, project_id): project})
        assert await resolve_risk_item_org_id(db, standin) == org_id


# --- resolve_organization_org_id / resolve_global_org_id -----------------------------------------


class TestOrganizationAndGlobalResolvers:
    async def test_organization_resolver_returns_its_own_id(self) -> None:
        org_id = uuid.uuid4()
        row = _row(id=org_id)
        db = _FakeSession()
        assert await resolve_organization_org_id(db, row) == org_id

    async def test_global_resolver_always_returns_none(self) -> None:
        db = _FakeSession()
        assert await resolve_global_org_id(db, _row(id=uuid.uuid4())) is None
        assert await resolve_global_org_id(db, _row()) is None


# --- apply_filters_and_search (pure query-building) -----------------------------------------------


class TestApplyFiltersAndSearch:
    def test_no_filters_no_search_returns_unmodified_query(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, (), (), {})
        assert str(result) == str(query)

    def test_filter_field_present_adds_where_clause(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, ("external_ref",), (), {"external_ref": "REQ-1"})
        compiled = str(result)
        assert "external_ref" in compiled
        assert "WHERE" in compiled

    def test_filter_field_absent_from_params_is_not_applied(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, ("external_ref",), (), {})
        assert "WHERE" not in str(result)

    def test_filter_field_empty_string_is_not_applied(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, ("external_ref",), (), {"external_ref": ""})
        assert "WHERE" not in str(result)

    def test_search_ignored_when_search_fields_not_configured(self) -> None:
        """`?q=` silently ignored for an entity with no `search_fields` configured (ADR-0022)."""
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, (), (), {"q": "widget"})
        assert "WHERE" not in str(result)

    def test_search_applied_when_search_fields_configured(self) -> None:
        # `.ilike()` compiles to `lower(x) LIKE lower(:param)` under the
        # generic/default dialect `str()` uses (real Postgres renders literal
        # `ILIKE`, but compiling against a dialect is unnecessary for this
        # test — only the WHERE-clause shape/columns/OR-joining matter here).
        query = select(Requirement)
        result = apply_filters_and_search(
            query, Requirement, (), ("description", "external_ref"), {"q": "widget"}
        )
        compiled = str(result)
        assert "LIKE" in compiled
        assert "lower(requirement.description)" in compiled
        assert "lower(requirement.external_ref)" in compiled
        assert " OR " in compiled

    def test_search_ignored_when_q_absent_even_if_search_fields_configured(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(query, Requirement, (), ("description",), {})
        assert "WHERE" not in str(result)

    def test_filter_and_search_combine(self) -> None:
        query = select(Requirement)
        result = apply_filters_and_search(
            query, Requirement, ("external_ref",), ("description",), {"external_ref": "REQ-1", "q": "widget"}
        )
        compiled = str(result)
        assert "requirement.external_ref = " in compiled
        assert "LIKE" in compiled


# --- ADR-0070: numeric columns in `search_fields` are CAST to text ---------------------------------


class TestSearchClauseNumericCast:
    """ADR-0070/NFR-70. Postgres has no `integer ~~* unknown` operator, so a
    bare `.ilike()` against an `Integer`/`BigInteger`/`Numeric` column is a
    hard `ProgrammingError` at query time — not an empty result. `_search_clause`
    therefore casts numeric columns to text first, which is what makes a numeric
    column listable in `search_fields` at all.

    These assert on the *compiled SQL shape*, which is the whole contract here:
    the cast either appears in the generated statement or the query cannot run
    against Postgres. The end-to-end proof that it genuinely matches rows lives
    in `tests/integration/test_search1_search_fields.py`.
    """

    def test_string_column_is_not_cast(self) -> None:
        compiled = str(_search_clause(TestStep, "action", "login"))
        assert "lower(test_step.action)" in compiled
        assert "CAST" not in compiled.upper()

    def test_integer_column_is_cast_to_text(self) -> None:
        compiled = str(_search_clause(TestStep, "sequence", "3"))
        assert "CAST(test_step.sequence AS VARCHAR)" in compiled
        assert "LIKE" in compiled

    def test_bigint_column_is_cast_to_text(self) -> None:
        """`BigInteger` subclasses `Integer`, so the two-entry isinstance check
        covers it without naming it — proven, not assumed."""
        compiled = str(_search_clause(Attachment, "size_bytes", "1024"))
        assert "CAST(attachment.size_bytes AS VARCHAR)" in compiled

    def test_mixed_text_and_numeric_search_fields_compile_together(self) -> None:
        """`TestStep`'s real shipped tuple: two text columns + one numeric."""
        result = apply_filters_and_search(
            select(TestStep), TestStep, (), ("action", "expected_result", "sequence"), {"q": "3"}
        )
        compiled = str(result)
        assert "lower(test_step.action)" in compiled
        assert "lower(test_step.expected_result)" in compiled
        assert "CAST(test_step.sequence AS VARCHAR)" in compiled
        assert compiled.count(" OR ") >= 2

    def test_numeric_search_still_ignored_when_q_absent(self) -> None:
        result = apply_filters_and_search(select(TestStep), TestStep, (), ("sequence",), {})
        assert "WHERE" not in str(result)

    def test_every_shipped_search_field_resolves_to_a_real_column(self) -> None:
        """ADR-0070's audit touched 17 of 27 configs by hand. A typo'd column
        name would not fail at import — only at the first `?q=` request, as a
        500. This walks the real registry and resolves every name."""
        from app.api.entity_registry import ALL_ENTITY_CONFIGS

        for config in ALL_ENTITY_CONFIGS.values():
            for field_name in config.search_fields:
                column = getattr(config.model, field_name, None)
                assert column is not None, f"{config.resource}.{field_name} is not a column"
                # Must be a real mapped column, not a relationship/hybrid.
                assert hasattr(column, "type"), f"{config.resource}.{field_name} has no column type"

    def test_no_entity_without_a_list_route_declares_search_fields(self) -> None:
        """`?q=` is only ever read by the list route, so `search_fields` on an
        entity with no `list` in `methods` is dead config. ADR-0070 deliberately
        left `organization`/`role_assignment` empty for exactly this reason."""
        from app.api.entity_registry import ALL_ENTITY_CONFIGS

        for config in ALL_ENTITY_CONFIGS.values():
            if config.search_fields:
                assert "list" in config.methods, (
                    f"{config.resource} declares search_fields but registers no list route"
                )


class TestApplySort:
    """ADR-0053 (sort). Pure query-building, same posture as `TestApplyFiltersAndSearch`."""

    _SORTABLE = frozenset({"external_ref", "description"})

    def test_no_sort_param_returns_unmodified_query(self) -> None:
        query = select(Requirement)
        result = apply_sort(query, Requirement, None, self._SORTABLE)
        assert str(result) == str(query)

    def test_empty_sort_param_returns_unmodified_query(self) -> None:
        query = select(Requirement)
        result = apply_sort(query, Requirement, "", self._SORTABLE)
        assert str(result) == str(query)

    def test_ascending_field_adds_order_by_asc(self) -> None:
        query = select(Requirement)
        result = apply_sort(query, Requirement, "external_ref", self._SORTABLE)
        compiled = str(result)
        assert "ORDER BY requirement.external_ref ASC" in compiled

    def test_leading_dash_adds_order_by_desc(self) -> None:
        query = select(Requirement)
        result = apply_sort(query, Requirement, "-external_ref", self._SORTABLE)
        compiled = str(result)
        assert "ORDER BY requirement.external_ref DESC" in compiled

    def test_field_not_in_sortable_set_raises_value_error(self) -> None:
        query = select(Requirement)
        with pytest.raises(ValueError, match="project_id"):
            apply_sort(query, Requirement, "project_id", self._SORTABLE)

    def test_bare_dash_raises_value_error(self) -> None:
        """`?sort=-` (dash, no field name) — empty field name, not a sortable column."""
        query = select(Requirement)
        with pytest.raises(ValueError):
            apply_sort(query, Requirement, "-", self._SORTABLE)

    def test_unknown_field_never_reaches_getattr(self) -> None:
        """A rejected field name must 422 via `ValueError`, never `AttributeError` —
        confirms the allow-list check runs before `getattr(model, ...)`."""
        query = select(Requirement)
        with pytest.raises(ValueError):
            apply_sort(query, Requirement, "not_a_real_column", self._SORTABLE)


# --- extract_scope_value / scope_validation_error -------------------------------------------------


def _config(scope_field: Any, **overrides: Any) -> CrudEntityConfig:
    from pydantic import BaseModel

    class _Schema(BaseModel):
        pass

    defaults: dict[str, Any] = dict(
        model=Requirement,
        resource="requirement",
        create_schema=None,
        update_schema=_Schema,
        summary_schema=_Schema,
        scope_field=scope_field,
        resolve_org_id=chain_resolver([]),
    )
    defaults.update(overrides)
    return CrudEntityConfig(**defaults)


class TestExtractScopeValue:
    def test_single_field_present_returns_it(self) -> None:
        config = _config("project_id")
        value = uuid.uuid4()
        result = extract_scope_value(config, {"project_id": str(value)})
        assert result == ("project_id", str(value))

    def test_single_field_missing_returns_none(self) -> None:
        config = _config("project_id")
        assert extract_scope_value(config, {}) is None

    def test_single_field_empty_string_returns_none(self) -> None:
        config = _config("project_id")
        assert extract_scope_value(config, {"project_id": ""}) is None

    def test_no_scope_configured_returns_none(self) -> None:
        config = _config(None)
        assert extract_scope_value(config, {"project_id": "x"}) is None

    def test_tuple_scope_exactly_one_present_returns_it(self) -> None:
        config = _config(("requirement_id", "test_plan_id"))
        value = uuid.uuid4()
        result = extract_scope_value(config, {"requirement_id": str(value)})
        assert result == ("requirement_id", str(value))

    def test_tuple_scope_neither_present_returns_none(self) -> None:
        config = _config(("requirement_id", "test_plan_id"))
        assert extract_scope_value(config, {}) is None

    def test_tuple_scope_both_present_returns_none(self) -> None:
        config = _config(("requirement_id", "test_plan_id"))
        result = extract_scope_value(
            config, {"requirement_id": str(uuid.uuid4()), "test_plan_id": str(uuid.uuid4())}
        )
        assert result is None


class TestScopeValidationError:
    def test_single_field_missing_message(self) -> None:
        config = _config("project_id")
        response = scope_validation_error(config, {})
        assert response.status_code == 422
        import json

        body = json.loads(response.body)
        assert body["code"] == "validation_error"
        assert body["field_errors"] == {"project_id": ["project_id is required."]}

    def test_tuple_neither_present_message(self) -> None:
        config = _config(("requirement_id", "test_plan_id"))
        response = scope_validation_error(config, {})
        import json

        body = json.loads(response.body)
        assert body["field_errors"] == {
            "requirement_id": ["exactly one of requirement_id or test_plan_id must be set"]
        }

    def test_tuple_both_present_message_matches_api_document_exactly(self) -> None:
        """Matches the API Document §7 documented example verbatim."""
        config = _config(("requirement_id", "test_plan_id"))
        response = scope_validation_error(
            config, {"requirement_id": str(uuid.uuid4()), "test_plan_id": str(uuid.uuid4())}
        )
        import json

        body = json.loads(response.body)
        assert body["field_errors"] == {
            "requirement_id": ["exactly one of requirement_id or test_plan_id must be set, not both"]
        }


# --- clamp_pagination ----------------------------------------------------------------------------


class TestClampPagination:
    def test_defaults_pass_through(self) -> None:
        assert clamp_pagination(1, 25) == (1, 25)

    def test_page_below_one_floors_to_one(self) -> None:
        assert clamp_pagination(0, 25)[0] == 1
        assert clamp_pagination(-5, 25)[0] == 1

    def test_page_size_below_one_floors_to_one(self) -> None:
        assert clamp_pagination(1, 0)[1] == 1
        assert clamp_pagination(1, -10)[1] == 1

    def test_page_size_above_max_ceilings_to_max(self) -> None:
        # DS-2/ADR-0041: default max_page_size raised 25 -> 100.
        assert clamp_pagination(1, 1000)[1] == 100

    def test_custom_max_page_size_respected(self) -> None:
        assert clamp_pagination(1, 1000, max_page_size=50) == (1, 50)

    def test_page_unbounded_above(self) -> None:
        assert clamp_pagination(999, 25)[0] == 999

    def test_page_size_500_clamps_to_exactly_100(self) -> None:
        # TC-DS-012: an over-ceiling request clamps to the new 100 ceiling,
        # not the requested value and not a 422 (this function never raises).
        assert clamp_pagination(1, 500)[1] == 100

    def test_page_size_101_clamps_to_100(self) -> None:
        # Boundary just above the ceiling.
        assert clamp_pagination(1, 101)[1] == 100

    def test_page_size_exactly_100_is_not_clamped(self) -> None:
        # TC-DS-012: the ceiling itself is inclusive, not off-by-one.
        assert clamp_pagination(1, 100)[1] == 100


# --- path/display-name helpers --------------------------------------------------------------------


class TestResourcePathAndDisplayName:
    @pytest.mark.parametrize(
        ("resource", "expected"),
        [
            ("requirement", "requirements"),
            ("test_condition", "test-conditions"),
            ("org_membership", "org-memberships"),
            ("entry_exit_criteria", "entry-exit-criteria"),
            ("role_assignment", "role-assignments"),
        ],
    )
    def test_resource_path(self, resource: str, expected: str) -> None:
        assert _resource_path(resource) == expected

    @pytest.mark.parametrize(
        ("resource", "expected"),
        [
            ("requirement", "Requirement"),
            ("test_condition", "Test condition"),
            ("org_membership", "Org membership"),
        ],
    )
    def test_display_name(self, resource: str, expected: str) -> None:
        assert _display_name(resource) == expected


# --- CrudEntityConfig defaults ---------------------------------------------------------------------


class TestCrudEntityConfigDefaults:
    def test_default_methods_is_all_five(self) -> None:
        config = _config("project_id")
        assert config.methods == frozenset({"list", "get", "create", "update", "delete"})

    def test_is_global_catalog_and_global_read_fallback_default_false(self) -> None:
        config = _config("project_id")
        assert config.is_global_catalog is False
        assert config.global_read_fallback is False

    def test_search_and_filter_fields_default_empty(self) -> None:
        config = _config("project_id")
        assert config.search_fields == ()
        assert config.filter_fields == ()


# --- ADR-0072: derived `filter_fields` --------------------------------------------------------------


class _FilterSummary(BaseModel):
    """Synthetic summary schema covering every branch of the filterable
    derivation: a plain string, a would-be `<textarea>` string, an enum, and
    an FK. `id` is excluded by `derive_entity_schema` itself, so it is here
    only to prove that exclusion still holds for `filterFields` too.

    Field names are chosen so that `title`/`project_id` DO resolve to real
    `Requirement` columns (`_config`'s default `model`) while `notes`/`status`
    deliberately do NOT — the `Text`-column half of the rule looks the field
    up on `config.model`, so both the "has a column" and "has no column"
    paths need a fixture. `Requirement.title` is a bounded `String` and
    `Requirement.project_id` a `Uuid`, so neither is excluded.
    """

    id: uuid.UUID
    title: str
    notes: str | None = None
    status: Literal["open", "closed"]
    project_id: uuid.UUID


class _TextColumnSummary(BaseModel):
    """`Requirement.description` is a real `mapped_column(Text, ...)` that
    carries NO `FieldMeta` at all — the exact shape the `long_text`-only rule
    missed (`long_text` is declared on one field in this repo; 16 columns are
    mapped `Text`). `title`/`external_ref` are plain `String` columns on the
    same model, so they pin that the check is `Text`, not `String`."""

    id: uuid.UUID
    title: str
    description: str
    external_ref: str | None = None


def _filter_config(**overrides: Any) -> CrudEntityConfig:
    return _config("project_id", summary_schema=_FilterSummary, **overrides)


def _filterable_flags(config: CrudEntityConfig) -> dict[str, bool]:
    return {entry["name"]: entry["filterable"] for entry in derive_entity_schema(config)["fields"]}


class TestFilterFieldsDerivation:
    """ADR-0072 (ENTITY-FILTER-1). `filter_fields` stops being a hand-kept
    per-entity tuple (7 of 27 configs declared one) and becomes derived from
    the same `derive_entity_schema` call `sortable_fields` already derives
    from — ADR-0053's "one source of truth, not a second hand-kept list",
    applied to filters.

    The regression these guard against is silent in both directions: a
    too-narrow derivation makes a column quietly unfilterable with no error,
    and a too-wide one exposes a column exact-matching can't usefully answer.
    """

    def test_every_field_is_filterable_by_default(self) -> None:
        """No `field_meta`, no `filter_fields` — the common case for all 27
        real configs after this ADR deletes their explicit tuples."""
        schema = derive_entity_schema(_filter_config())
        assert schema["filterFields"] == ["title", "notes", "status", "project_id"]
        assert all(entry["filterable"] for entry in schema["fields"])

    def test_id_is_never_a_filter_field(self) -> None:
        """`derive_entity_schema` drops `id` from `fields` outright, so it can
        never reach `filterFields` either."""
        assert "id" not in _filterable_flags(_filter_config())
        assert "id" not in derive_entity_schema(_filter_config())["filterFields"]

    def test_long_text_field_is_not_filterable(self) -> None:
        """First of the three structural markers for "a value nobody can type
        an exact match for": a field whose derived `type` is `"text"`
        (`FieldMeta.long_text`) is excluded by the derivation itself, NOT by a
        hand-written `filterable=False` entry.

        The other two — a real `Text` model column (the far larger set) and a
        `JSON`/`JSONB` one — are
        `test_real_text_column_without_long_text_is_not_filterable` and
        `test_json_column_is_not_filterable` below. `?q=` (ADR-0070) is what
        covers the text columns properly; nothing covers the blob.
        """
        config = _filter_config(field_meta={"notes": FieldMeta(long_text=True)})
        fields = {entry["name"]: entry for entry in derive_entity_schema(config)["fields"]}

        assert fields["notes"]["type"] == "text", "fixture sanity: `long_text` promotes the derived type"
        assert fields["notes"]["filterable"] is False
        assert "notes" not in derive_entity_schema(config)["filterFields"]
        # Every *other* field is untouched — the exclusion is per-field, not
        # "this entity has a text column, so turn filtering off".
        assert derive_entity_schema(config)["filterFields"] == ["title", "status", "project_id"]

    def test_real_text_column_without_long_text_is_not_filterable(self) -> None:
        """THE assertion that catches the gap a `long_text`-only rule leaves.

        `Requirement.description` is `mapped_column(Text, ...)` and carries no
        `FieldMeta` whatsoever — under a `long_text`-only rule it derives as
        `type: "string"` and would be offered as an exact-match filter, which
        is precisely what ADR-0072's own rationale says must not happen. Held
        as its own test rather than folded into the `long_text` one, because
        the two rules are independent and `long_text` covers exactly ONE field
        in this repo against `Text`'s sixteen columns.
        """
        config = _config("project_id", summary_schema=_TextColumnSummary)
        fields = {entry["name"]: entry for entry in derive_entity_schema(config)["fields"]}

        assert fields["description"]["filterable"] is False
        assert "description" not in derive_entity_schema(config)["filterFields"]
        # The derived *type* is untouched — `type` drives the form control
        # (`long_text` alone makes a `<textarea>`); only `filterable` changes.
        assert fields["description"]["type"] == "string"

    def test_plain_string_columns_on_the_same_model_stay_filterable(self) -> None:
        """`Text` subclasses `String`. If the exclusion ever checks `String`
        instead, every string column in the schema silently stops being
        filterable — this is the test that catches that widening."""
        schema = derive_entity_schema(_config("project_id", summary_schema=_TextColumnSummary))
        assert schema["filterFields"] == ["title", "external_ref"]

    def test_json_column_is_not_filterable(self) -> None:
        """`TestLog.payload` (`JSONB`) is the schema's only structured-blob
        column, and it is excluded for the same reason as a `Text` one: there
        is no value a person can type that exact-matches a whole document.

        This case is *worse* than the text one rather than better, which is
        why "it doesn't 500" was not a reason to leave it in: SQLAlchemy
        serializes the raw query string to valid jsonb and Postgres has a
        `jsonb = jsonb` operator, so the filter would have been a clean,
        silent, always-empty result — indistinguishable from "no such record".
        """
        from app.api.entity_registry import ALL_ENTITY_CONFIGS

        schema = derive_entity_schema(ALL_ENTITY_CONFIGS["test-logs"])
        payload = next(f for f in schema["fields"] if f["name"] == "payload")

        assert payload["filterable"] is False
        assert "payload" not in schema["filterFields"]
        # The entity is not left with nothing to filter on — checked here
        # rather than assumed, since an entity whose ONLY column were a blob
        # would be a real finding rather than a detail.
        assert schema["filterFields"] == ["test_execution_id", "logged_at", "event_type"]

    def test_json_exclusion_uses_the_generic_type_not_the_postgres_dialect_one(self) -> None:
        """`postgresql.JSONB` subclasses the dialect-agnostic `sqlalchemy.JSON`,
        so the check is written against the latter — a dialect-specific one
        would silently miss a future plain-`JSON` column. `JSON` subclasses
        neither `String` nor `Text`, so it genuinely needs its own clause."""
        from sqlalchemy import JSON, String, Text
        from sqlalchemy.dialects.postgresql import JSONB

        assert issubclass(JSONB, JSON)
        assert not issubclass(JSON, String) and not issubclass(JSON, Text)

    def test_enum_column_stays_filterable_despite_subclassing_string(self) -> None:
        """SQLAlchemy's `Enum` also subclasses `String`. A closed vocabulary is
        exactly what exact-match filtering is for (ADR-0070 §4), so it must
        survive the `Text` exclusion."""
        from app.api.entity_registry import ALL_ENTITY_CONFIGS

        defects = derive_entity_schema(ALL_ENTITY_CONFIGS["defects"])
        assert "severity" in defects["filterFields"]
        assert "status" in defects["filterFields"]

    def test_field_with_no_matching_model_column_defaults_to_filterable(self) -> None:
        """A served field that resolves to no mapped column at all has no type
        to judge; the permissive default keeps a future computed/derived
        Pydantic field from silently losing filterability."""
        flags = _filterable_flags(_filter_config())
        assert not hasattr(Requirement, "notes"), "fixture premise: `notes` is not a Requirement column"
        assert flags["notes"] is True

    def test_long_text_exclusion_beats_an_explicit_filterable_true(self) -> None:
        """`filterable` defaults to `True`, so a `long_text` field's `FieldMeta`
        says `filterable=True` unless someone types otherwise — the structural
        rule has to win regardless, or the default would silently re-admit it."""
        config = _filter_config(field_meta={"notes": FieldMeta(long_text=True, filterable=True)})
        assert _filterable_flags(config)["notes"] is False

    def test_field_meta_filterable_false_excludes_the_field(self) -> None:
        """The per-field override half of the rule, for a column where exact
        matching would be misleading for a reason the type can't express."""
        config = _filter_config(field_meta={"title": FieldMeta(filterable=False)})
        assert _filterable_flags(config)["title"] is False
        assert derive_entity_schema(config)["filterFields"] == ["notes", "status", "project_id"]

    def test_explicit_filter_fields_narrows_the_derived_set(self) -> None:
        """`CrudEntityConfig.filter_fields` survives as a narrowing override:
        naming a subset restricts the derived set to exactly it."""
        config = _filter_config(filter_fields=("status", "project_id"))
        assert derive_entity_schema(config)["filterFields"] == ["status", "project_id"]
        flags = _filterable_flags(config)
        assert flags["status"] is True and flags["project_id"] is True
        assert flags["title"] is False and flags["notes"] is False

    def test_explicit_filter_fields_cannot_widen_past_the_derivation(self) -> None:
        """"Narrowing" is literal: naming a `long_text` field does not make it
        filterable, and naming a field this entity doesn't have adds nothing."""
        config = _filter_config(
            filter_fields=("notes", "title", "not_a_field_on_this_entity"),
            field_meta={"notes": FieldMeta(long_text=True)},
        )
        assert derive_entity_schema(config)["filterFields"] == ["title"]

    def test_filter_fields_key_always_equals_the_fields_flagged_filterable(self) -> None:
        """The invariant that makes `filterFields` safe for the route to
        consume: the served list and the per-field flags are computed from one
        expression, so they cannot drift. Checked under every override
        combination, not just the default one.
        """
        for config in (
            _filter_config(),
            _filter_config(field_meta={"notes": FieldMeta(long_text=True)}),
            _filter_config(field_meta={"title": FieldMeta(filterable=False)}),
            _filter_config(filter_fields=("status",)),
        ):
            schema = derive_entity_schema(config)
            assert schema["filterFields"] == [e["name"] for e in schema["fields"] if e["filterable"]]

    def test_filter_fields_is_a_plain_list_of_strings(self) -> None:
        """Serialization shape, same posture as `searchFields` — JSON-encodable,
        never a tuple (`test_entity_schema_derivation.py` pins the sibling key)."""
        schema = derive_entity_schema(_filter_config())
        assert isinstance(schema["filterFields"], list)
        assert all(isinstance(name, str) for name in schema["filterFields"])


# --- ADR-0072: per-column filter-value coercion -------------------------------------------------


class TestCoerceFilterValue:
    """ADR-0072. Every query param arrives as a `str`; comparing it directly
    against a `uuid`/`timestamptz`/`date`/`integer`/`boolean`/enum column is a
    DB-level error surfacing as a **500**, not an empty result. With
    `filter_fields` derived across all 27 entities those column types are now
    reachable, so each gets a parse rule and a `ValueError` on failure.

    Built against real ORM model columns (not synthetic ones) because the
    branch under test is `isinstance(column.type, ...)` — a fake column would
    test the fake's type hierarchy, not SQLAlchemy's.
    """

    # --- Uuid ---------------------------------------------------------------

    def test_uuid_column_parses_a_uuid_string(self) -> None:
        value = uuid.uuid4()
        assert coerce_filter_value(Requirement.project_id, "project_id", str(value)) == value

    def test_uuid_column_rejects_a_non_uuid(self) -> None:
        with pytest.raises(ValueError, match="project_id"):
            coerce_filter_value(Requirement.project_id, "project_id", "not-a-uuid")

    # --- Boolean ------------------------------------------------------------

    @pytest.mark.parametrize("raw", ["true", "TRUE", "True", "1"])
    def test_boolean_column_accepts_truthy_spellings(self, raw: str) -> None:
        assert coerce_filter_value(Role.is_system_role, "is_system_role", raw) is True

    @pytest.mark.parametrize("raw", ["false", "FALSE", "False", "0"])
    def test_boolean_column_accepts_falsy_spellings(self, raw: str) -> None:
        assert coerce_filter_value(Role.is_system_role, "is_system_role", raw) is False

    @pytest.mark.parametrize("raw", ["yes", "no", "maybe", "2"])
    def test_boolean_column_rejects_anything_else(self, raw: str) -> None:
        with pytest.raises(ValueError, match="is_system_role"):
            coerce_filter_value(Role.is_system_role, "is_system_role", raw)

    # --- Integer ------------------------------------------------------------

    def test_integer_column_parses_digits(self) -> None:
        assert coerce_filter_value(TestStep.sequence, "sequence", "3") == 3

    def test_big_integer_column_parses_digits(self) -> None:
        """`BigInteger` subclasses `Integer` — covered without its own branch,
        the same by-subclassing completeness argument ADR-0070 §1 makes."""
        assert coerce_filter_value(Attachment.size_bytes, "size_bytes", "1024") == 1024

    @pytest.mark.parametrize("raw", ["three", "3.5", "", "0x10"])
    def test_integer_column_rejects_non_integers(self, raw: str) -> None:
        with pytest.raises(ValueError, match="sequence"):
            coerce_filter_value(TestStep.sequence, "sequence", raw)

    # --- Date / DateTime ----------------------------------------------------

    def test_date_column_parses_an_iso_date(self) -> None:
        import datetime

        assert coerce_filter_value(TestCycle.start_date, "start_date", "2026-09-15") == datetime.date(2026, 9, 15)

    @pytest.mark.parametrize("raw", ["15/09/2026", "2026-13-01", "tomorrow"])
    def test_date_column_rejects_a_non_iso_value(self, raw: str) -> None:
        with pytest.raises(ValueError, match="start_date"):
            coerce_filter_value(TestCycle.start_date, "start_date", raw)

    def test_datetime_column_parses_an_iso_timestamp(self) -> None:
        import datetime

        parsed = coerce_filter_value(Requirement.created_at, "created_at", "2026-09-15T12:30:00+00:00")
        assert parsed == datetime.datetime(2026, 9, 15, 12, 30, tzinfo=datetime.UTC)

    def test_datetime_column_rejects_a_non_iso_value(self) -> None:
        with pytest.raises(ValueError, match="created_at"):
            coerce_filter_value(Requirement.created_at, "created_at", "last tuesday")

    # --- Enum ---------------------------------------------------------------

    def test_enum_column_accepts_a_declared_value(self) -> None:
        assert coerce_filter_value(Defect.severity, "severity", "high") == "high"

    @pytest.mark.parametrize("raw", ["urgent", "HIGH", ""])
    def test_enum_column_rejects_an_undeclared_value(self, raw: str) -> None:
        """Postgres answers an unknown enum label with `invalid input value
        for enum defect_severity` — a 500. The allow-list check turns that
        into a 422 before the query is ever built. Note the rejection is
        case-SENSITIVE: `"HIGH"` is not a declared member."""
        with pytest.raises(ValueError, match="severity"):
            coerce_filter_value(Defect.severity, "severity", raw)

    def test_enum_is_checked_before_the_string_fallthrough(self) -> None:
        """SQLAlchemy's `Enum` subclasses `String`. If the branch order ever
        flips, an undeclared value would pass straight through as a string and
        reach the DB — this is the test that catches that reordering."""
        from sqlalchemy import Enum as SAEnum
        from sqlalchemy import String

        assert issubclass(SAEnum, String), "premise of this ordering rule"
        with pytest.raises(ValueError):
            coerce_filter_value(Defect.severity, "severity", "definitely-not-a-severity")

    # --- passthrough --------------------------------------------------------

    def test_string_column_passes_through_unchanged(self) -> None:
        assert coerce_filter_value(Requirement.external_ref, "external_ref", "REQ-1") == "REQ-1"

    def test_text_column_passes_through_unchanged(self) -> None:
        """`Text` subclasses `String`; there is nothing to parse. (Whether a
        `Text` column should be *offered* as a filter at all is the
        `long_text` derivation's question, not this function's.)"""
        assert coerce_filter_value(Requirement.description, "description", "anything") == "anything"

    def test_unknown_or_missing_column_type_passes_through(self) -> None:
        """Defensive: an object with no `.type` at all is passed through rather
        than raising, so a future non-column derived field can never 500 here."""
        assert coerce_filter_value(object(), "whatever", "raw") == "raw"

    # --- error payload ------------------------------------------------------

    def test_value_error_carries_the_field_name_as_args_zero(self) -> None:
        """The caller (`list_items`) reads `exc.args[0]` to key its
        `field_errors` body — exactly `apply_sort`'s own contract."""
        with pytest.raises(ValueError) as excinfo:
            coerce_filter_value(Requirement.project_id, "project_id", "nope")
        assert excinfo.value.args[0] == "project_id"


class TestApplyFiltersAndSearchCoercion:
    """ADR-0072. `apply_filters_and_search` stays pure (no DB) while gaining
    coercion — these assert the wiring, not the parse rules themselves."""

    def test_uuid_filter_is_coerced_not_passed_as_a_raw_string(self) -> None:
        value = uuid.uuid4()
        query = apply_filters_and_search(
            select(Requirement), Requirement, ("project_id",), (), {"project_id": str(value)}
        )
        bound = query.compile().params
        assert value in bound.values(), "the bound param must be a real UUID, not its string spelling"

    def test_malformed_filter_value_raises_value_error_naming_the_field(self) -> None:
        with pytest.raises(ValueError, match="project_id"):
            apply_filters_and_search(
                select(Requirement), Requirement, ("project_id",), (), {"project_id": "not-a-uuid"}
            )

    def test_absent_filter_param_is_still_a_no_op_not_a_coercion_error(self) -> None:
        """An omitted param must never reach `coerce_filter_value` — `None` is
        not parseable as a UUID, so a missing guard here would 422 every
        unfiltered list request."""
        result = apply_filters_and_search(select(Requirement), Requirement, ("project_id",), (), {})
        assert "WHERE" not in str(result)

    def test_empty_string_filter_param_is_still_a_no_op(self) -> None:
        """Same guard, for the shape a cleared UI filter control actually
        sends (`?project_id=`)."""
        result = apply_filters_and_search(
            select(Requirement), Requirement, ("project_id",), (), {"project_id": ""}
        )
        assert "WHERE" not in str(result)

    def test_enum_filter_survives_and_a_bad_one_raises(self) -> None:
        good = apply_filters_and_search(select(Defect), Defect, ("severity",), (), {"severity": "high"})
        assert "defect.severity = " in str(good)
        with pytest.raises(ValueError, match="severity"):
            apply_filters_and_search(select(Defect), Defect, ("severity",), (), {"severity": "nope"})
