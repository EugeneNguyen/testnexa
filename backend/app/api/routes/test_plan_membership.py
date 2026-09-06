"""PLAN-1: `TestPlan` suite membership + the two-hop coverage query (ADR-0031).

Source: ADR-0031 (these four bespoke routes, the cross-project `422`, the
duplicate-include `409`, the deduplicated coverage query, and the explicit
finding that no RBAC bundle extension is needed), API Document §4, ADR-0030
(REQ-4's `TestSuiteTestCase` membership trio — the direct template this module
follows), ADR-0022 (the generic CRUD factory that already serves `TestPlan`'s
own identifier/scope/approach/staffing/schedule CRUD in full, untouched here).

`TestPlan` itself needs nothing from this module: ADR-0022's factory already
gives it all 5 methods in `planning.py`, and `POST /test-plans` already creates
a row with `status=draft` by column default, which is FR-PLAN-1 AC1 closed with
zero new route code. What had no route at all was `TestPlanTestSuite`, the
junction table — present in the initial migration and the model layer, but
unreachable over HTTP, exactly the gap REQ-4 found for `TestSuiteTestCase`.
These four routes close that, plus AC2's own derived query:

```
POST   /test-plans/{id}/test-suites/{suite_id}   test_plan.update
DELETE /test-plans/{id}/test-suites/{suite_id}   test_plan.update
GET    /test-plans/{id}/test-suites              test_plan.read
GET    /test-plans/{id}/test-cases               test_plan.read   -- coverage
```

Kept in its own module rather than in `planning.py`, whose docstring scopes it
to the generic-factory configs (plus, as of PLAN-1, the `status`-transition
guard that has to live next to `_TEST_PLAN_CONFIG` because it is wired into
it) — the same split ADR-0028/ADR-0030 made for their own bespoke modules.

Gating is the shape every bespoke route in this codebase uses (see
`test_suite_membership.py`/`test_condition_authoring.py` for the canonical
write-up):

1. Fetch the `TestPlan` named by the path segment.
2. Resolve its `org_id` by reusing the *same* `chain_resolver([])` expression
   `_TEST_PLAN_CONFIG` already uses in `planning.py` (`TestPlan` carries
   `project_id` directly -> `Project.org_id`), so the tenant walk can never
   drift between the generic and bespoke surfaces for this entity.
3. Missing row OR unresolvable org OR no `OrgMembership` (any status) in the
   resolved org -> `404`, all indistinguishable (NFR-1/ADR-0007).
4. Membership present but permission missing -> `403`, via `has_permission`
   called directly — `require_permission` reads `org_id`/`project_id` off
   *path* params and there is no `org_id` segment at this depth.

**No resolver-completeness risk here** (contrast ADR-0029/ADR-0030's own
`TestCase` fan-out, and `backend/CLAUDE.md`'s standing warning about it): these
routes create no new *entity* row shape at all — the only row written is the
`TestPlanTestSuite` join row, and both sides of it (`TestPlan`, `TestSuite`)
carry a **direct** `project_id` column already covered by their existing
`chain_resolver([])`. There is no branching resolver whose branches could fail
to cover a shape this module introduces. The cross-project check is therefore a
plain column comparison, not a resolver walk — ADR-0031 decision #1 calls this
out as the specific way PLAN-1 is simpler than REQ-4.

Status codes carrying PLAN-1-specific meaning, all fixed by ADR-0031 rather
than left to implementation-time judgment:

- `422 validation_error` — same-org but cross-*project* include. A business-rule
  rejection, not a tenant boundary: the caller has already proven membership in
  the shared org, so there is no existence left to hide.
- `409 already_included_in_plan` — the `uq_test_plan_test_suite` unique
  constraint fired. Distinct from `TestSuiteTestCase`'s own `already_in_suite`
  on purpose: a different relationship gets its own code, so a client can
  branch/log on it without inferring the route family from context.
- `404` on `DELETE` of a non-member — deliberately asymmetric with `POST`'s
  `409`, same posture ADR-0030 established.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import _org_membership_exists, chain_resolver
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.assets import TestCase, TestSuite, TestSuiteTestCase
from app.models.planning import TestPlan, TestPlanTestSuite
from app.schemas.assets import (
    TestCaseListResponse,
    TestCaseSummary,
    TestSuiteListResponse,
    TestSuiteSummary,
)

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."
_PLAN_NOT_FOUND_MESSAGE = "Test plan not found."
_SUITE_NOT_FOUND_MESSAGE = "Test suite not found."

# Same page-size bounds as the sibling membership module, so every paginated
# response in this cluster behaves identically.
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 25

# The exact resolver expressions `planning.py`'s `_TEST_PLAN_CONFIG` and
# `assets.py`'s `_TEST_SUITE_CONFIG` already use, reused rather than
# re-derived: both entities carry `project_id` directly, so the hop list is
# empty and `resolve_terminal_org_id` does the `project_id` -> `Project.org_id`
# step.
_resolve_test_plan_org_id = chain_resolver([])
_resolve_test_suite_org_id = chain_resolver([])


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


async def _load_plan_for_actor(
    db: AsyncSession,
    plan_id: UUID,
    actor: User | AIAgent,
    permission: str,
) -> tuple[TestPlan, UUID] | JSONResponse:
    """Shared 404-then-403 gate for all four routes.

    Returns `(plan, org_id)` on success, or the `JSONResponse` the caller
    should return as-is. Factored out because all four routes open with the
    byte-identical boundary and only differ in the permission code — keeping
    one copy means the NFR-1 existence-hiding behavior cannot drift between the
    read and write routes of the same feature.
    """
    plan = await db.get(TestPlan, plan_id)
    if plan is None:
        return _error(404, "not_found", _PLAN_NOT_FOUND_MESSAGE)

    org_id = await _resolve_test_plan_org_id(db, plan)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", _PLAN_NOT_FOUND_MESSAGE)

    if not await has_permission(str(actor.actor_id), str(org_id), permission):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    return plan, org_id


def _test_suite_summary(suite: TestSuite) -> TestSuiteSummary:
    """Mirrors `assets.py`'s own summary construction verbatim."""
    return TestSuiteSummary(
        id=suite.id,
        project_id=suite.project_id,
        name=suite.name,
        purpose=suite.purpose,
    )


def _test_case_summary(test_case: TestCase) -> TestCaseSummary:
    """Mirrors `assets.py`/`test_suite_membership.py`'s helper verbatim."""
    return TestCaseSummary(
        id=test_case.id,
        test_condition_id=test_case.test_condition_id,
        test_level_id=test_case.test_level_id,
        test_type_id=test_case.test_type_id,
        created_by_actor_id=test_case.created_by_actor_id,
        title=test_case.title,
        preconditions=test_case.preconditions,
        expected_result=test_case.expected_result,
        status=test_case.status,
    )


@router.post("/test-plans/{id}/test-suites/{suite_id}", status_code=201)
async def include_suite_in_plan(
    id: UUID,
    suite_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Include TestSuite `suite_id` in TestPlan `id` (FR-PLAN-1 AC2), ADR-0031.

    Writes exactly one row (`TestPlanTestSuite`) — nothing is denormalized or
    copied onto the plan, which is precisely what makes the sibling `GET`
    routes' membership and coverage views live rather than snapshots.

    A single `TestSuite` may be included in any number of plans: the unique
    constraint is on the *pair*, not on `test_suite_id`, so including the same
    suite in a second plan is a normal `201`, not a conflict.
    """
    gate = await _load_plan_for_actor(db, id, actor, "test_plan.update")
    if isinstance(gate, JSONResponse):
        return gate
    plan, org_id = gate

    suite = await db.get(TestSuite, suite_id)
    if suite is None:
        return _error(404, "not_found", _SUITE_NOT_FOUND_MESSAGE)

    # A suite resolving to a different org — or to no org at all — is
    # indistinguishable from a nonexistent one at this boundary (NFR-1), so it
    # is `404`, never the cross-project `422` below.
    suite_org_id = await _resolve_test_suite_org_id(db, suite)
    if suite_org_id is None or suite_org_id != org_id:
        return _error(404, "not_found", _SUITE_NOT_FOUND_MESSAGE)

    # Past the tenant boundary: same org, caller already authorized. A project
    # mismatch from here on is a business-rule rejection with no existence left
    # to hide, hence `422` rather than `404` (ADR-0031 decision #1). Both sides
    # carry `project_id` directly — no resolver walk needed, unlike ADR-0030's
    # three-branch `TestCase` case.
    if suite.project_id != plan.project_id:
        return _error(422, "validation_error", "This test suite belongs to a different project.")

    db.add(TestPlanTestSuite(test_plan_id=plan.id, test_suite_id=suite.id))
    try:
        await db.flush()
    except IntegrityError:
        # `uq_test_plan_test_suite` — the pair already exists. Caught at the DB
        # rather than pre-checked with an extra existence query, matching
        # `crud_factory.create_item`'s and `test_suite_membership.py`'s posture.
        await db.rollback()
        return _error(
            409, "already_included_in_plan", "This test suite is already included in the plan."
        )

    await db.commit()
    return JSONResponse(
        status_code=201,
        content={"test_plan_id": str(plan.id), "test_suite_id": str(suite.id)},
    )


@router.delete("/test-plans/{id}/test-suites/{suite_id}", status_code=204, response_model=None)
async def remove_suite_from_plan(
    id: UUID,
    suite_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove TestSuite `suite_id` from TestPlan `id` (FR-PLAN-1 AC2).

    Deletes only the join row — the `TestSuite` itself is untouched and remains
    included in any other plan it was added to, and every `TestCase` in it
    survives untouched (the coverage query simply stops reaching them through
    this plan).

    A join row that doesn't exist (never included, or already removed) is
    `404`, not an idempotent `204` (ADR-0031, mirroring ADR-0030). Note this
    runs *after* the plan's own `404`/`403` gate, so a `404` here never reveals
    anything about a suite the caller couldn't already see.
    """
    gate = await _load_plan_for_actor(db, id, actor, "test_plan.update")
    if isinstance(gate, JSONResponse):
        return gate
    plan, _org_id = gate

    membership = await db.scalar(
        select(TestPlanTestSuite).where(
            TestPlanTestSuite.test_plan_id == plan.id,
            TestPlanTestSuite.test_suite_id == suite_id,
        )
    )
    if membership is None:
        return _error(404, "not_found", "This test suite is not included in this test plan.")

    await db.delete(membership)
    await db.commit()
    # `Response(status_code=204)` + `response_model=None` on the decorator,
    # exactly as `crud_factory.delete_item` does it — FastAPI asserts that a
    # 204 route declares no response body.
    return Response(status_code=204)


@router.get("/test-plans/{id}/test-suites", response_model=TestSuiteListResponse)
async def list_suites_in_plan(
    id: UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestSuiteListResponse | JSONResponse:
    """List the TestSuites currently included in TestPlan `id` (FR-PLAN-1 AC2).

    A live query joining `TestPlanTestSuite` to `TestSuite` on every call — not
    a cached or materialized snapshot. Since include/remove write nothing but
    the join row, there is no denormalized copy that could go stale between
    them.

    A plan with no included suites resolves with an empty `items` and a `200` —
    the plan existing and having no suites yet are different things (ADR-0031's
    zero-membership posture, inherited from ADR-0030).

    Gated on `test_plan.read` (not `.update`) so a role holding only read access
    can view a plan's scope without being able to change it.
    """
    gate = await _load_plan_for_actor(db, id, actor, "test_plan.read")
    if isinstance(gate, JSONResponse):
        return gate
    plan, _org_id = gate

    page = max(page, 1)
    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)

    query = (
        select(TestSuite)
        .join(TestPlanTestSuite, TestPlanTestSuite.test_suite_id == TestSuite.id)
        .where(TestPlanTestSuite.test_plan_id == plan.id)
        .order_by(TestSuite.id)
    )
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    suites = result.scalars().all()

    return TestSuiteListResponse(
        items=[_test_suite_summary(suite) for suite in suites],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/test-plans/{id}/test-cases", response_model=TestCaseListResponse)
async def list_covered_test_cases(
    id: UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCaseListResponse | JSONResponse:
    """Coverage query: which TestCases does executing TestPlan `id` cover?

    FR-PLAN-1 AC2's literal claim, and the reason a suites-list alone does not
    close it — that answers a one-hop-shallower question. This route resolves
    the full two-hop chain in a single call:

        TestPlan
          -> every included TestSuite      (via `TestPlanTestSuite`)
          -> every member TestCase in each (via `TestSuiteTestCase`)

    **Deduplicated.** A `TestCase` that belongs to two different suites both
    included in this plan is returned **once**, not twice — the `.distinct()`
    below, not a naive join-and-list. This is the single most important
    behavior in this module and the one a single-suite fixture structurally
    cannot verify (it cannot distinguish "deduplicated" from "never had a
    duplicate to begin with"), which is why Test Design §27 mandates a
    two-suites-sharing-one-TestCase fixture for it.

    `.distinct()` is safe as a whole-row `SELECT DISTINCT` here: every selected
    `TestCase` column is a scalar type, and the duplicate rows this dedupes are
    literally the same row reached by two join paths, so they are equal in
    every column, not merely in `id`. `order_by(TestCase.id)` keeps pagination
    deterministic across calls (without it, a plan whose coverage exceeds one
    page could return the same case on two pages, or none).

    A plan with zero included suites — or whose included suites have zero
    members — returns `200` with an empty list, not a `404` (ADR-0031: a valid,
    common state, not an error). Gated on `test_plan.read`.
    """
    gate = await _load_plan_for_actor(db, id, actor, "test_plan.read")
    if isinstance(gate, JSONResponse):
        return gate
    plan, _org_id = gate

    page = max(page, 1)
    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)

    query = (
        select(TestCase)
        .join(TestSuiteTestCase, TestSuiteTestCase.test_case_id == TestCase.id)
        .join(
            TestPlanTestSuite,
            TestPlanTestSuite.test_suite_id == TestSuiteTestCase.test_suite_id,
        )
        .where(TestPlanTestSuite.test_plan_id == plan.id)
        .distinct()
        .order_by(TestCase.id)
    )
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    test_cases = result.scalars().all()

    return TestCaseListResponse(
        items=[_test_case_summary(test_case) for test_case in test_cases],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


__all__ = ["router"]
