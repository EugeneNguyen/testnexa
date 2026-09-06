"""Unit tests for REQ-4's `_resolve_test_case_project_id` (ADR-0030).

Same "hand-rolled fake session" convention as `tests/unit/test_crud_factory.py`
and `tests/unit/test_execution_trace_resolvers.py` (those modules' docstrings
explain why) — no DB, no live server.

This helper earns a unit test rather than resting on the integration suite for
two reasons the integration layer structurally cannot cover cheaply:

1. **All three ADR-0029 branches in isolation.** The integration suite exercises
   branches 1 and 2 (TestCondition-mediated and direct-link) because TC-REQ-012
   requires at least two; branch 3 (an existing `TestSuiteTestCase` link) needs
   a `TestCase` that is *already* in some other suite and in no requirement,
   which is awkward to seed over HTTP and trivial to state here.
2. **The `None` outcomes.** A dangling FK at each hop, and the genuinely
   orphaned `TestCase` reachable by no branch at all, are schema-legal shapes
   that no create path in this codebase produces — so no integration fixture
   can construct them without hand-writing broken rows.

Why the distinction matters: this function decides `422`-vs-`201`, so a wrong
`None` silently blocks a legitimate add, and a wrong *project* silently permits
the cross-project membership ADR-0030 exists to reject. It never gates tenant
isolation (that stays with `resolve_test_case_org_id`), which is why the
branch-order duplication between the two is safe — see the helper's own
docstring.
"""

import uuid
from typing import Any

from app.api.routes.test_suite_membership import _resolve_test_case_project_id
from app.models.assets import Requirement, TestCondition, TestSuite


class _FakeSession:
    """`db.get` by (model, pk), plus a `db.scalar` queue.

    Extends `test_execution_trace_resolvers.py`'s fake with a *sequence* of
    scalar results rather than one fixed value: `_resolve_test_case_project_id`
    can issue two different `scalar` queries in one call (the
    `RequirementTestCaseLink` lookup, then the `TestSuiteTestCase` fallback),
    and a single fixed value could not distinguish them.
    """

    def __init__(
        self,
        rows: dict[tuple[type, Any], Any] | None = None,
        scalar_results: list[Any] | None = None,
    ) -> None:
        self._rows = rows or {}
        self._scalar_results = list(scalar_results or [])

    async def get(self, model: type, pk: Any) -> Any:
        return self._rows.get((model, pk))

    async def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        if not self._scalar_results:
            return None
        return self._scalar_results.pop(0)


def _row(**attrs: Any) -> Any:
    class _Row:
        pass

    r = _Row()
    for key, value in attrs.items():
        setattr(r, key, value)
    return r


# --- Branch 1: test_condition_id -> TestCondition -> Requirement.project_id --------------------


class TestConditionMediatedBranch:
    async def test_resolves_project_via_test_condition(self) -> None:
        condition_id, requirement_id, project_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={
                (TestCondition, condition_id): _row(id=condition_id, requirement_id=requirement_id),
                (Requirement, requirement_id): _row(id=requirement_id, project_id=project_id),
            }
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=condition_id)

        assert await _resolve_test_case_project_id(session, test_case) == project_id

    async def test_missing_test_condition_row_resolves_none(self) -> None:
        """A dangling `test_condition_id` short-circuits to `None` — it must not
        fall through to the link-table branches, which would resolve a
        *different* project for a row whose own declared parent is broken.
        """
        session = _FakeSession(rows={}, scalar_results=[_row(requirement_id=uuid.uuid4())])
        test_case = _row(id=uuid.uuid4(), test_condition_id=uuid.uuid4())

        assert await _resolve_test_case_project_id(session, test_case) is None

    async def test_missing_requirement_row_resolves_none(self) -> None:
        condition_id, requirement_id = uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={(TestCondition, condition_id): _row(id=condition_id, requirement_id=requirement_id)}
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=condition_id)

        assert await _resolve_test_case_project_id(session, test_case) is None


# --- Branch 2: RequirementTestCaseLink -> Requirement.project_id -------------------------------


class TestDirectLinkBranch:
    async def test_resolves_project_via_requirement_link(self) -> None:
        requirement_id, project_id = uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={(Requirement, requirement_id): _row(id=requirement_id, project_id=project_id)},
            scalar_results=[_row(requirement_id=requirement_id)],
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=None)

        assert await _resolve_test_case_project_id(session, test_case) == project_id

    async def test_dangling_requirement_link_resolves_none(self) -> None:
        session = _FakeSession(
            rows={},
            scalar_results=[_row(requirement_id=uuid.uuid4())],
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=None)

        assert await _resolve_test_case_project_id(session, test_case) is None


# --- Branch 3: TestSuiteTestCase -> TestSuite.project_id ---------------------------------------


class TestSuiteLinkFallbackBranch:
    async def test_resolves_project_via_existing_suite_membership(self) -> None:
        """The branch the integration suite doesn't reach: no TestCondition and
        no Requirement link, but the case is already a member of another suite.
        """
        suite_id, project_id = uuid.uuid4(), uuid.uuid4()
        session = _FakeSession(
            rows={(TestSuite, suite_id): _row(id=suite_id, project_id=project_id)},
            # First scalar (RequirementTestCaseLink) misses, second hits.
            scalar_results=[None, _row(test_suite_id=suite_id)],
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=None)

        assert await _resolve_test_case_project_id(session, test_case) == project_id

    async def test_dangling_suite_link_resolves_none(self) -> None:
        session = _FakeSession(
            rows={},
            scalar_results=[None, _row(test_suite_id=uuid.uuid4())],
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=None)

        assert await _resolve_test_case_project_id(session, test_case) is None


# --- Orphaned: reachable by no branch at all ---------------------------------------------------


class TestOrphanedTestCase:
    async def test_orphaned_test_case_resolves_none(self) -> None:
        """Reachable by none of the three branches -> `None`.

        Callers must treat this as "cannot prove same-project" and reject
        (`422`), never as a match — a resolver returning some default project
        here would let an untraceable `TestCase` into any suite.
        """
        session = _FakeSession(rows={}, scalar_results=[None, None])
        test_case = _row(id=uuid.uuid4(), test_condition_id=None)

        assert await _resolve_test_case_project_id(session, test_case) is None

    async def test_branch_order_prefers_test_condition_over_links(self) -> None:
        """Branch 1 wins when `test_condition_id` is set, even if a
        `RequirementTestCaseLink` also exists pointing somewhere else.

        Locks the documented branch *order* (ADR-0029's), not just that some
        branch resolves — the two could disagree for a row carrying both.
        """
        condition_id = uuid.uuid4()
        requirement_id = uuid.uuid4()
        condition_project_id = uuid.uuid4()
        other_requirement_id = uuid.uuid4()
        other_project_id = uuid.uuid4()

        session = _FakeSession(
            rows={
                (TestCondition, condition_id): _row(id=condition_id, requirement_id=requirement_id),
                (Requirement, requirement_id): _row(
                    id=requirement_id, project_id=condition_project_id
                ),
                (Requirement, other_requirement_id): _row(
                    id=other_requirement_id, project_id=other_project_id
                ),
            },
            scalar_results=[_row(requirement_id=other_requirement_id)],
        )
        test_case = _row(id=uuid.uuid4(), test_condition_id=condition_id)

        resolved = await _resolve_test_case_project_id(session, test_case)
        assert resolved == condition_project_id
        assert resolved != other_project_id
