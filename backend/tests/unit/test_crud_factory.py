"""Unit tests for `app/api/crud_factory.py` (API-1, ADR-0021).

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
from typing import Any

import pytest
from sqlalchemy import select

from app.api.crud_factory import (
    CrudEntityConfig,
    _display_name,
    _resource_path,
    apply_filters_and_search,
    chain_resolver,
    clamp_pagination,
    extract_scope_value,
    resolve_global_org_id,
    resolve_organization_org_id,
    resolve_risk_item_org_id,
    resolve_terminal_org_id,
    resolve_test_case_org_id,
    resolve_via_test_case,
    scope_validation_error,
)
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite
from app.models.governance import RiskItem
from app.models.planning import TestCycle, TestPlan
from app.models.project import Project
from app.models.tenancy import Organization


class _FakeSession:
    """Minimal `db.get`/`db.scalar` fake — just enough surface for `resolve_org_id` functions.

    `_rows` is `{(model, pk): row_or_None}`; `.get()` returns `None` for any
    key not registered (matches a real `AsyncSession.get()` on a missing
    row). `_scalar_result` is a single canned return value for `.scalar()`
    (only `resolve_test_case_org_id`'s `TestSuiteTestCase` link lookup calls
    it) — good enough since these tests only ever need one canned answer per
    test case, not real query introspection.
    """

    def __init__(self, rows: dict[tuple[type, Any], Any] | None = None, scalar_result: Any = None) -> None:
        self._rows = rows or {}
        self._scalar_result = scalar_result

    async def get(self, model: type, pk: Any) -> Any:
        return self._rows.get((model, pk))

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
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

    async def test_falls_back_to_test_suite_link_when_condition_unset(self) -> None:
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
            scalar_result=link,
        )
        assert await resolve_test_case_org_id(db, row) == org_id

    async def test_orphaned_row_resolves_to_none(self) -> None:
        """No `test_condition_id`, no `TestSuiteTestCase` link -> unresolvable (ADR-0021 edge case #1)."""
        row = _row(id=uuid.uuid4(), test_condition_id=None)
        db = _FakeSession(scalar_result=None)
        assert await resolve_test_case_org_id(db, row) is None

    async def test_condition_set_but_missing_resolves_to_none(self) -> None:
        row = _row(id=uuid.uuid4(), test_condition_id=uuid.uuid4())
        db = _FakeSession()  # condition lookup misses
        assert await resolve_test_case_org_id(db, row) is None


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
        """`?q=` silently ignored for an entity with no `search_fields` configured (ADR-0021)."""
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
        assert clamp_pagination(1, 1000)[1] == 25

    def test_custom_max_page_size_respected(self) -> None:
        assert clamp_pagination(1, 1000, max_page_size=50) == (1, 50)

    def test_page_unbounded_above(self) -> None:
        assert clamp_pagination(999, 25)[0] == 999


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
