"""Unit tests for ADR-0025's new resolver *composition* (execution/trace routes).

Same "hand-rolled fake session" convention as `tests/unit/test_crud_factory.py`
(that module's own docstring explains why) — no DB, no live server. These
tests exist to prove the composition wiring in `app/api/routes/execution.py`/
`app/api/routes/trace.py` is correct, not to re-test `chain_resolver`/
`resolve_via_test_case` themselves (already covered by
`test_crud_factory.py`).
"""

import uuid
from typing import Any

from app.api.routes.execution import _resolve_test_execution_org_id, _resolve_test_log_org_id
from app.api.routes.trace import (
    _REQUIREMENT_TEST_CASE_LINK_CONFIG,
    _REQUIREMENT_TEST_CONDITION_LINK_CONFIG,
    _TEST_CASE_DEFECT_LINK_CONFIG,
    _TEST_CONDITION_TEST_CASE_LINK_CONFIG,
)
from app.models.assets import Requirement, TestCase, TestCondition
from app.models.execution import TestExecution
from app.models.planning import TestCycle, TestPlan
from app.models.project import Project


class _FakeSession:
    """Minimal `db.get`/`db.scalar` fake, mirrors `test_crud_factory.py`'s own."""

    def __init__(self, rows: dict[tuple[type, Any], Any] | None = None, scalar_result: Any = None) -> None:
        self._rows = rows or {}
        self._scalar_result = scalar_result

    async def get(self, model: type, pk: Any) -> Any:
        return self._rows.get((model, pk))

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        return self._scalar_result


def _row(**attrs: Any) -> Any:
    class _Row:
        pass

    r = _Row()
    for key, value in attrs.items():
        setattr(r, key, value)
    return r


# --- TestExecution's own resolver (2-hop: TestCycle -> TestPlan) -------------------------------


class TestResolveTestExecutionOrgId:
    async def test_resolves_through_test_cycle_and_test_plan(self) -> None:
        test_cycle_id = uuid.uuid4()
        test_plan_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        cycle = _row(test_plan_id=test_plan_id)
        plan = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(test_cycle_id=test_cycle_id)
        db = _FakeSession(
            rows={
                (TestCycle, test_cycle_id): cycle,
                (TestPlan, test_plan_id): plan,
                (Project, project_id): project,
            }
        )
        assert await _resolve_test_execution_org_id(db, row) == org_id

    async def test_missing_test_cycle_short_circuits_to_none(self) -> None:
        row = _row(test_cycle_id=uuid.uuid4())
        db = _FakeSession()
        assert await _resolve_test_execution_org_id(db, row) is None


# --- TestLog's bespoke fetch-then-delegate resolver ---------------------------------------------


class TestResolveTestLogOrgId:
    async def test_delegates_through_test_execution_to_test_cycle_and_plan(self) -> None:
        test_execution_id = uuid.uuid4()
        test_cycle_id = uuid.uuid4()
        test_plan_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        execution = _row(test_cycle_id=test_cycle_id)
        cycle = _row(test_plan_id=test_plan_id)
        plan = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(test_execution_id=test_execution_id)
        db = _FakeSession(
            rows={
                (TestExecution, test_execution_id): execution,
                (TestCycle, test_cycle_id): cycle,
                (TestPlan, test_plan_id): plan,
                (Project, project_id): project,
            }
        )
        assert await _resolve_test_log_org_id(db, row) == org_id

    async def test_missing_test_execution_resolves_to_none(self) -> None:
        row = _row(test_execution_id=uuid.uuid4())
        db = _FakeSession()
        assert await _resolve_test_log_org_id(db, row) is None

    async def test_missing_fk_resolves_to_none(self) -> None:
        row = _row(test_execution_id=None)
        db = _FakeSession()
        assert await _resolve_test_log_org_id(db, row) is None


# --- The 4 link tables' resolvers (composed straight from crud_factory helpers) -----------------


class TestLinkTableResolvers:
    async def test_requirement_test_case_link_one_hop(self) -> None:
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(requirement_id=requirement_id)
        db = _FakeSession(rows={(Requirement, requirement_id): requirement, (Project, project_id): project})
        resolver = _REQUIREMENT_TEST_CASE_LINK_CONFIG.resolve_org_id
        assert await resolver(db, row) == org_id

    async def test_requirement_test_condition_link_one_hop(self) -> None:
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(requirement_id=requirement_id)
        db = _FakeSession(rows={(Requirement, requirement_id): requirement, (Project, project_id): project})
        resolver = _REQUIREMENT_TEST_CONDITION_LINK_CONFIG.resolve_org_id
        assert await resolver(db, row) == org_id

    async def test_test_condition_test_case_link_two_hop(self) -> None:
        test_condition_id = uuid.uuid4()
        requirement_id = uuid.uuid4()
        project_id = uuid.uuid4()
        org_id = uuid.uuid4()

        condition = _row(requirement_id=requirement_id)
        requirement = _row(project_id=project_id)
        project = _row(org_id=org_id)

        row = _row(test_condition_id=test_condition_id)
        db = _FakeSession(
            rows={
                (TestCondition, test_condition_id): condition,
                (Requirement, requirement_id): requirement,
                (Project, project_id): project,
            }
        )
        resolver = _TEST_CONDITION_TEST_CASE_LINK_CONFIG.resolve_org_id
        assert await resolver(db, row) == org_id

    async def test_test_case_defect_link_delegates_to_test_case_resolver(self) -> None:
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
        resolver = _TEST_CASE_DEFECT_LINK_CONFIG.resolve_org_id
        assert await resolver(db, row) == org_id
