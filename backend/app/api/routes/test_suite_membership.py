"""REQ-4: `TestSuite` membership — the many-to-many join no generic route covers (ADR-0030).

Source: API Document §4 (`POST`/`DELETE /test-suites/{id}/test-cases/{case_id}`
contracts), ADR-0030 (these three bespoke routes, cross-project `422`,
duplicate-add `409`, and the explicit finding that no RBAC bundle extension is
needed), ADR-0022 (the generic CRUD factory that already serves `TestSuite`'s
own name/purpose CRUD in full — untouched by this module), ADR-0029
(`resolve_test_case_org_id`'s three-branch chain, reused verbatim below).

`TestSuite` itself needs nothing here: ADR-0022's factory already gives it all
5 methods in `assets.py`. What had no route at all was `TestSuiteTestCase`, the
junction table — present in the initial migration and the model layer, but
unreachable over HTTP. These three routes close exactly that gap and nothing
else:

```
POST   /test-suites/{id}/test-cases/{case_id}   test_suite.update
DELETE /test-suites/{id}/test-cases/{case_id}   test_suite.update
GET    /test-suites/{id}/test-cases             test_suite.read
```

Kept in their own module rather than in `assets.py`, whose docstring scopes it
to the generic-factory routes plus REQ-2's own bespoke pair — the same split
ADR-0028 made when it gave REQ-3 `test_condition_authoring.py`.

Gating is the shape every bespoke route in this codebase uses (see
`test_condition_authoring.py`'s docstring for the canonical write-up):

1. Fetch the `TestSuite` named by the path segment.
2. Resolve its `org_id` by reusing the *same* `chain_resolver([])` expression
   `_TEST_SUITE_CONFIG` already uses in `assets.py` (`TestSuite` carries
   `project_id` directly -> `Project.org_id`), so the tenant walk can never
   drift between the generic and bespoke surfaces for this entity.
3. Missing row OR unresolvable org OR no `OrgMembership` (any status) in the
   resolved org -> `404`, all indistinguishable (NFR-1/ADR-0007
   existence-hiding).
4. Membership present but permission missing -> `403`, via `has_permission`
   called directly — `require_permission` reads `org_id`/`project_id` off
   *path* params and there is no `org_id` segment at this depth, the same
   reason `releases.py`/`test_condition_authoring.py`/the factory all call
   `has_permission` directly.

The `TestCase` side of the two write routes reuses `resolve_test_case_org_id`
verbatim (never a re-derived walk), and requires the case to resolve to the
*same* org as the suite — a case in another org is indistinguishable from a
nonexistent one, so it is `404`, never `403`/`422`.

Three status codes carry REQ-4-specific meaning, all fixed by ADR-0030 rather
than left to implementation-time judgment:

- `422 validation_error` — same-org but cross-*project* add. A business-rule
  rejection, not a tenant boundary: the caller has already proven membership in
  the shared org, so there is no existence left to hide, only an invalid
  relationship being requested.
- `409 already_in_suite` — the `(test_suite_id, test_case_id)` unique
  constraint fired. Mirrors `org_memberships.py`'s `membership_already_exists`
  precedent: `422` is this API's code for malformed/invalid input, `409` for a
  well-formed request against an already-true relationship.
- `404` on `DELETE` of a non-member — deliberately asymmetric with `POST`'s
  `409`. A `DELETE` verb's "already true" case reads as "nothing to find here,"
  not as a conflict.

Like `test_condition_authoring.py`, this module imports the factory's
`_org_membership_exists` rather than keeping a seventh verbatim copy of it, per
ADR-0030's "reuse 100% of existing resolver/permission-check primitives — no
new backend architecture."
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
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
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite, TestSuiteTestCase
from app.models.trace import RequirementTestCaseLink
from app.schemas.assets import TestCaseListResponse, TestCaseSummary

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."
_SUITE_NOT_FOUND_MESSAGE = "Test suite not found."
_CASE_NOT_FOUND_MESSAGE = "Test case not found."

# Same page-size bounds as `assets.py`'s own bespoke list route, so every
# paginated response in this cluster behaves identically.
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 25

# The exact resolver expression `assets.py`'s `_TEST_SUITE_CONFIG` already
# uses, reused rather than re-derived: `TestSuite` carries `project_id`
# directly, so the hop list is empty and `resolve_terminal_org_id` does the
# `project_id` -> `Project.org_id` step.
_resolve_test_suite_org_id = chain_resolver([])


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors `test_condition_authoring.py`/`releases.py`/`crud_factory.py`'s own
    `_error()` verbatim — this codebase's established per-module convention is a
    local copy, not a shared import.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _resolve_test_case_project_id(db: AsyncSession, test_case: TestCase) -> UUID | None:
    """Resolve a `TestCase`'s own project, walking ADR-0029's three branches.

    Deliberately a separate function from `resolve_test_case_org_id` rather
    than a refactor of it, even though the two walk the identical branch order
    (`test_condition_id` -> `Requirement.project_id`; else any
    `RequirementTestCaseLink` -> `Requirement.project_id`; else any
    `TestSuiteTestCase` -> `TestSuite.project_id`). The org resolver's terminal
    step (`resolve_terminal_org_id`) converts `project_id` -> `Project.org_id`
    and discards the `project_id` on the way, so there is no existing seam to
    reuse without reworking a resolver the whole generic-CRUD surface depends
    on — out of proportion to this one business-rule check.

    The duplication is safe in a way a duplicated *org* walk would not be: this
    result never gates tenant isolation. The `404` boundary above every caller
    of this function is still decided solely by `resolve_test_case_org_id`, so
    if these two ever drift, the failure mode is a wrong `422`, never a crossed
    tenant boundary (NFR-1).

    Returns `None` for a `TestCase` reachable by none of the three branches —
    genuinely orphaned, no create path in this codebase produces one. Callers
    treat that as "cannot prove same-project", i.e. reject.
    """
    test_condition_id = getattr(test_case, "test_condition_id", None)
    if test_condition_id is not None:
        condition = await db.get(TestCondition, test_condition_id)
        if condition is None:
            return None
        requirement = await db.get(Requirement, condition.requirement_id)
        return requirement.project_id if requirement is not None else None

    requirement_link = await db.scalar(
        select(RequirementTestCaseLink)
        .where(RequirementTestCaseLink.test_case_id == test_case.id)
        .limit(1)
    )
    if requirement_link is not None:
        requirement = await db.get(Requirement, requirement_link.requirement_id)
        return requirement.project_id if requirement is not None else None

    suite_link = await db.scalar(
        select(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id == test_case.id).limit(1)
    )
    if suite_link is None:
        return None
    suite = await db.get(TestSuite, suite_link.test_suite_id)
    return suite.project_id if suite is not None else None


async def _load_suite_for_actor(
    db: AsyncSession,
    suite_id: UUID,
    actor: User | AIAgent,
    permission: str,
) -> tuple[TestSuite, UUID] | JSONResponse:
    """Shared 404-then-403 gate for all three routes.

    Returns `(suite, org_id)` on success, or the `JSONResponse` the caller
    should return as-is. Factored out because all three routes open with the
    byte-identical boundary and only differ in the permission code — keeping
    one copy means the NFR-1 existence-hiding behavior cannot drift between the
    read and write routes of the same feature.
    """
    suite = await db.get(TestSuite, suite_id)
    if suite is None:
        return _error(404, "not_found", _SUITE_NOT_FOUND_MESSAGE)

    org_id = await _resolve_test_suite_org_id(db, suite)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", _SUITE_NOT_FOUND_MESSAGE)

    if not await has_permission(str(actor.actor_id), str(org_id), permission):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    return suite, org_id


def _test_case_summary(test_case: TestCase) -> TestCaseSummary:
    """Mirrors `assets.py`'s helper of the same name verbatim."""
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


@router.post("/test-suites/{id}/test-cases/{case_id}", status_code=201)
async def add_test_case_to_suite(
    id: UUID,
    case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Add TestCase `case_id` to TestSuite `id` (FR-REQ-4 AC1), ADR-0030's add contract.

    Writes exactly one row (`TestSuiteTestCase`) — nothing is denormalized or
    copied onto the suite, which is precisely what makes the sibling `GET`
    route's membership view live rather than a snapshot (AC2).

    A single `TestCase` may belong to any number of suites: the unique
    constraint is on the *pair*, not on `test_case_id`, so adding the same case
    to a second suite is a normal `201`, not a conflict.
    """
    gate = await _load_suite_for_actor(db, id, actor, "test_suite.update")
    if isinstance(gate, JSONResponse):
        return gate
    suite, org_id = gate

    test_case = await db.get(TestCase, case_id)
    if test_case is None:
        return _error(404, "not_found", _CASE_NOT_FOUND_MESSAGE)

    # Reused verbatim (ADR-0029), never re-derived. A case resolving to a
    # different org — or to no org at all — is indistinguishable from a
    # nonexistent one at this boundary (NFR-1), so it is `404`, not `422`.
    case_org_id = await resolve_test_case_org_id(db, test_case)
    if case_org_id is None or case_org_id != org_id:
        return _error(404, "not_found", _CASE_NOT_FOUND_MESSAGE)

    # Past the tenant boundary: same org, caller already authorized. A
    # project mismatch from here on is a business-rule rejection with no
    # existence left to hide, hence `422` rather than `404` (ADR-0030 §1).
    case_project_id = await _resolve_test_case_project_id(db, test_case)
    if case_project_id is None or case_project_id != suite.project_id:
        # Message string fixed verbatim by API Document §7's documented body.
        return _error(422, "validation_error", "This test case belongs to a different project.")

    db.add(TestSuiteTestCase(test_suite_id=suite.id, test_case_id=test_case.id))
    try:
        await db.flush()
    except IntegrityError:
        # `uq_test_suite_test_case` — the pair already exists. Caught at the
        # DB rather than pre-checked with an extra existence query, matching
        # `crud_factory.create_item`'s own posture.
        await db.rollback()
        # Message string fixed verbatim by API Document §7's documented body.
        return _error(409, "already_in_suite", "This test case is already in the suite.")

    await db.commit()
    return JSONResponse(
        status_code=201, content={"test_suite_id": str(suite.id), "test_case_id": str(test_case.id)}
    )


@router.delete("/test-suites/{id}/test-cases/{case_id}", status_code=204, response_model=None)
async def remove_test_case_from_suite(
    id: UUID,
    case_id: UUID,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove TestCase `case_id` from TestSuite `id` (FR-REQ-4 AC2).

    Deletes only the join row — the `TestCase` itself is untouched and remains
    a member of any other suite it was added to.

    A join row that doesn't exist (never added, or already removed) is `404`,
    not an idempotent `204` (ADR-0030). Note this runs *after* the suite's own
    `404`/`403` gate, so a `404` here never reveals anything about a case the
    caller couldn't already see.
    """
    gate = await _load_suite_for_actor(db, id, actor, "test_suite.update")
    if isinstance(gate, JSONResponse):
        return gate
    suite, _org_id = gate

    membership = await db.scalar(
        select(TestSuiteTestCase).where(
            TestSuiteTestCase.test_suite_id == suite.id,
            TestSuiteTestCase.test_case_id == case_id,
        )
    )
    if membership is None:
        return _error(404, "not_found", "This test case is not in this test suite.")

    await db.delete(membership)
    await db.commit()
    # `Response(status_code=204)` + `response_model=None` on the decorator,
    # exactly as `crud_factory.delete_item` does it — FastAPI asserts that a
    # 204 route declares no response body, which a `JSONResponse` return
    # annotation would imply.
    return Response(status_code=204)


@router.get("/test-suites/{id}/test-cases", response_model=TestCaseListResponse)
async def list_test_cases_in_suite(
    id: UUID,
    page: int = 1,
    page_size: int = _DEFAULT_PAGE_SIZE,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCaseListResponse | JSONResponse:
    """List the TestCases currently in TestSuite `id` (FR-REQ-4 AC2).

    A live query joining `TestSuiteTestCase` to `TestCase` on every call — not
    a cached or materialized snapshot. That is the literal mechanism behind
    AC2's "reflects current membership": since add/remove write nothing but the
    join row, there is no denormalized copy that could go stale between them.

    Gated on `test_suite.read` (not `.update`) so `tester`, whose seeded bundle
    holds exactly `test_suite.read`, can view a suite's membership without
    being able to change it.
    """
    gate = await _load_suite_for_actor(db, id, actor, "test_suite.read")
    if isinstance(gate, JSONResponse):
        return gate
    suite, _org_id = gate

    page = max(page, 1)
    page_size = min(max(page_size, 1), _MAX_PAGE_SIZE)

    query = (
        select(TestCase)
        .join(TestSuiteTestCase, TestSuiteTestCase.test_case_id == TestCase.id)
        .where(TestSuiteTestCase.test_suite_id == suite.id)
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
