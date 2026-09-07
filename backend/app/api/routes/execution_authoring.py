"""PLAN-3: the bespoke `TestExecution` create route + scope check (ADR-0033).

Source: ADR-0033 §Decision (this route's exact boundary and the decision to
build the *full* route now rather than a scope-check helper with no caller),
API Document §4/§6 (`POST /test-cycles/{id}/executions` contract, and the
`create_test_execution` MCP tool already pointed at this same route),
ADR-0031/`test_plan_membership.py` (the two-hop coverage join this module
reuses verbatim), ADR-0029 (`TestCase`'s 3-branch resolver), FR-PLAN-3 AC3,
FR-EXEC-1 AC1.

```
POST /test-cycles/{id}/executions    test_execution.create
```

`TestExecution` had full generic CRUD (ADR-0025) including an unrestricted
`POST /test-executions` — but nothing enforced FR-PLAN-3 AC3's scope rule
against it. Landing this route therefore *requires* dropping `"create"` from
`execution.py`'s `_TEST_EXECUTION_CONFIG` in the same change
(`backend/CLAUDE.md`'s standing rule): leaving the generic route reachable
alongside this one would let any caller bypass the scope check entirely by
using the unrestricted path, which is not a weaker version of the gate but no
gate at all.

Boundary, in order:

1. Fetch the `TestCycle` named by the path segment; resolve its `org_id` via
   the *same* two-hop chain `execution.py`'s `_resolve_test_execution_org_id`
   already walks one level down from (`TestCycle.test_plan_id` ->
   `TestPlan.project_id` -> `Project.org_id`). Missing cycle, unresolvable org,
   or no `OrgMembership` (any status) -> `404`, all indistinguishable (NFR-1).
2. Missing `test_execution.create` -> `403`.
3. Fetch the body's `test_case_id` and resolve it through `TestCase`'s existing
   3-branch resolver (ADR-0029) — missing, unresolvable, or a **different org**
   -> `404` (existence-hiding). This subsumes the cross-project case for
   `TestCase` specifically: a cross-project `TestCase` can never legally be a
   member of a suite included in this cycle's plan to begin with, since REQ-4's
   and PLAN-1's own upstream `422` checks prevent that link from ever existing.
   That is why this route has no `TestCase` cross-project `422` class, unlike
   `test_cycle_creation.py`'s two.
4. **PLAN-3 scope check** — the `EXISTS` form of PLAN-1's own coverage query
   (see `_test_case_is_in_plan_scope` below). Not covered -> `422
   validation_error`, **never `404`**: this is FR-PLAN-3 AC3's own literal
   business-rule claim, not a tenant boundary, and by this point the caller has
   already proven org membership *and* resolved the `TestCase` to a real row,
   so there is no existence left to hide.
5. Insert, `executed_by_actor_id` stamped from the authenticated actor.
   `IntegrityError` -> rollback -> `422`, same posture as every other bespoke
   create route here.

**Scope, deliberately narrow:** this route delivers only what FR-PLAN-3 AC3 and
FR-EXEC-1 AC1's own literal text require — a gated create. Dashboard
aggregation (EXEC-1 AC2) and re-run history assertions (EXEC-1 AC3) are
unaffected either way — they are read-side/insert-shape concerns this plain
insert already satisfies for free — but are not additionally built or tested
here; raising a `Defect` (EXEC-3) is untouched.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import (
    _org_membership_exists,
    chain_resolver,
    resolve_test_case_org_id,
)
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.assets import TestCase, TestSuiteTestCase
from app.models.execution import TestExecution
from app.models.planning import TestCycle, TestPlan, TestPlanTestSuite
from app.schemas.execution import CreateExecutionForCycleRequest, TestExecutionSummary

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."
_CYCLE_NOT_FOUND_MESSAGE = "Test cycle not found."
_TEST_CASE_NOT_FOUND_MESSAGE = "Test case not found."
_OUT_OF_SCOPE_MESSAGE = (
    "This test case is not in scope for this test cycle's test plan."
)

# The exact resolver expression `execution.py`'s `_TEST_EXECUTION_CONFIG` walks
# for a `TestExecution` row, minus its own first hop — applied here directly to
# the `TestCycle` row this route already holds. Kept as one expression so the
# tenant walk cannot drift between the generic `TestExecution` surface and this
# bespoke create.
_resolve_test_cycle_org_id = chain_resolver([(TestPlan, "test_plan_id")])


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors every other route module's own `_error()` verbatim — this
    codebase's established per-module convention is a local copy, not a shared
    import.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _test_case_is_in_plan_scope(
    db: AsyncSession, test_plan_id: UUID, test_case_id: UUID
) -> bool:
    """FR-PLAN-3 AC3's scope check: is `test_case_id` covered by `test_plan_id`?

    This is the `EXISTS` form of the *same* two-hop join
    `test_plan_membership.list_covered_test_cases` (`GET
    /test-plans/{id}/test-cases`, ADR-0031) uses for its paginated listing:

    ```
    TestPlan
      -> every included TestSuite      (via `TestPlanTestSuite`)
      -> every member TestCase in each (via `TestSuiteTestCase`)
    ```

    Built from the same two join predicates on purpose (ADR-0033's
    "Positive"): if the listing route's join and this gate's join were written
    independently, they could silently diverge over time, and the failure mode
    of that divergence is a `TestCase` the UI *shows* as covered being rejected
    as out-of-scope (or worse, the reverse). TC-PLAN-008 pins the two together
    by additionally asserting the accepted `TestCase` appears in that route's
    own result set.

    `EXISTS` rather than the full list because this is a single-row membership
    question — no pagination, no dedup concern (the listing route's
    `.distinct()` exists because a `TestCase` reachable through two included
    suites would otherwise appear twice; "reachable at all" is unaffected by
    multiplicity).
    """
    membership_exists = (
        select(TestSuiteTestCase.id)
        .join(
            TestPlanTestSuite,
            TestPlanTestSuite.test_suite_id == TestSuiteTestCase.test_suite_id,
        )
        .where(
            TestPlanTestSuite.test_plan_id == test_plan_id,
            TestSuiteTestCase.test_case_id == test_case_id,
        )
    )
    return bool(await db.scalar(select(exists(membership_exists))))


@router.post(
    "/test-cycles/{id}/executions",
    response_model=TestExecutionSummary,
    status_code=201,
)
async def create_execution_for_cycle(
    id: UUID,
    payload: CreateExecutionForCycleRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestExecutionSummary | JSONResponse:
    """Record a `TestExecution` against TestCycle `id` (FR-PLAN-3 AC3, FR-EXEC-1 AC1).

    `executed_by_actor_id` is always the authenticated caller — the field does
    not exist on `CreateExecutionForCycleRequest` at all, so a body attempting
    to supply one is ignored by Pydantic rather than honored (same posture the
    removed generic schema's own docstring established, and the same
    actor-stamping class `TestPlan.created_by_actor_id` already has).
    """
    cycle = await db.get(TestCycle, id)
    if cycle is None:
        return _error(404, "not_found", _CYCLE_NOT_FOUND_MESSAGE)

    org_id = await _resolve_test_cycle_org_id(db, cycle)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", _CYCLE_NOT_FOUND_MESSAGE)

    if not await has_permission(str(actor.actor_id), str(org_id), "test_execution.create"):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    test_case = await db.get(TestCase, payload.test_case_id)
    if test_case is None:
        return _error(404, "not_found", _TEST_CASE_NOT_FOUND_MESSAGE)

    # ADR-0029's 3-branch resolver, reused verbatim rather than re-derived —
    # a `TestCase` reaching a different org (or no org at all) is
    # indistinguishable from a nonexistent one at this boundary (NFR-1).
    test_case_org_id = await resolve_test_case_org_id(db, test_case)
    if test_case_org_id is None or test_case_org_id != org_id:
        return _error(404, "not_found", _TEST_CASE_NOT_FOUND_MESSAGE)

    # Past the tenant boundary. From here on, "not in scope" is a business-rule
    # rejection with no existence left to hide -> `422`, never `404`.
    if not await _test_case_is_in_plan_scope(db, cycle.test_plan_id, test_case.id):
        return _error(422, "validation_error", _OUT_OF_SCOPE_MESSAGE)

    execution = TestExecution(
        test_cycle_id=cycle.id,
        test_case_id=test_case.id,
        executed_by_actor_id=actor.actor_id,
        result=payload.result,
        actual_result=payload.actual_result,
        executed_at=payload.executed_at,
    )
    db.add(execution)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(execution)

    return TestExecutionSummary(
        id=execution.id,
        test_cycle_id=execution.test_cycle_id,
        test_case_id=execution.test_case_id,
        executed_by_actor_id=execution.executed_by_actor_id,
        # `.value` extracted explicitly rather than relying on `str, Enum`'s
        # implicit str behavior — same posture `releases.py` uses for
        # `TestExecutionResult` and `crud_factory._to_summary` for every `Enum`
        # column, `hasattr`-guarded for the same reason.
        result=execution.result.value if hasattr(execution.result, "value") else execution.result,
        actual_result=execution.actual_result,
        executed_at=execution.executed_at,
    )


__all__ = ["router"]
