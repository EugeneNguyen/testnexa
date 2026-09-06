"""PLAN-3: the bespoke `TestCycle` create route (ADR-0033, FR-PLAN-3 AC1/AC2).

Source: ADR-0033 §Decision (this route's exact 404/422 boundary, the
independent per-field cross-project check, and the decision that AC2's "create
an Environment inline" is a *frontend* two-sequential-calls flow rather than a
new atomic backend route), API Document §4 (`POST /test-plans/{id}/test-cycles`
contract), Database Document §3.7, ADR-0031 (`test_plan_membership.py` — the
direct template this module follows), ADR-0030 (cross-project `422` posture),
ADR-0022 (the generic CRUD factory, which still serves `TestCycle`'s
`GET`/`PATCH`/`DELETE` in `planning.py`, untouched here).

`TestCycle`'s `create` was reserved for this story by name in three separate
places (`planning.py`'s and `app/schemas/planning.py`'s module docstrings, API
Document §3 footnote ``******``) — the factory registered only
`list`/`get`/`update`/`delete` for it. This module closes that gap:

```
POST /test-plans/{id}/test-cycles    test_cycle.create
```

Why bespoke rather than re-enabling the factory's own `create` behind a guard
(ADR-0033 §Alternatives): this route has to fetch and validate **two** separate
related rows (`Release`, `Environment`) beyond the entity's own scope field —
a shape `crud_factory.create_item`'s single-row path has no hook for, unlike
the `update_guard` PLAN-1 added, which only ever inspects the row being updated
and the request body.

Gating is the shape every bespoke route in this codebase uses:

1. Fetch the `TestPlan` named by the path segment.
2. Resolve its `org_id` by reusing the *same* `chain_resolver([])` expression
   `_TEST_PLAN_CONFIG` already uses in `planning.py`, so the tenant walk can
   never drift between the generic and bespoke surfaces for this entity.
3. Missing row OR unresolvable org OR no `OrgMembership` (any status) in the
   resolved org -> `404`, all indistinguishable (NFR-1/ADR-0007).
4. Membership present but permission missing -> `403`, via `has_permission`
   called directly (`require_permission` reads `org_id`/`project_id` off
   *path* params and there is no `org_id` segment at this depth).

**Three-way check per related field, applied independently to `release_id` and
`environment_id`** (ADR-0033 §Decision step 3, Test Design §29's "two
independent fields" class):

- missing row, or resolves to no org / a **different org** -> `404`
  (existence-hiding: there is no target-org existence to leak, NFR-1).
- same org, **different project** than the `TestPlan`'s -> `422
  validation_error` (business-rule rejection — the caller has already proven
  membership in the shared org, so there is no existence left to hide, ADR-0030
  /ADR-0031's established posture).
- same project -> accepted.

The two checks are **separate `if` branches over separate rows, not one shared
comparison** — which is exactly why TC-PLAN-015 and TC-PLAN-016 are two
independent test fixtures rather than one exercising both: a fix (or a
regression) scoped to only one of the two fields must not be able to pass the
other's case.

**No resolver-completeness risk here** (contrast ADR-0029, and
`backend/CLAUDE.md`'s standing warning): `TestCycle`'s own resolver is already
`chain_resolver([(TestPlan, "test_plan_id")])`, and the only FK this route
writes that the resolver walks is `test_plan_id` — exactly the one hop it
already covers. There is no new row shape introduced for it to lack a branch
for. TC-PLAN-006 still asserts the create-then-immediate-read round trip
anyway, per that same standing rule: a create-only assertion structurally
cannot catch this class of bug, so the round trip is the test regardless of how
confident the reasoning is.

**Duplicate `name`s within one `TestPlan` are a plain `201`, not a conflict** —
there is no unique constraint on `(test_plan_id, name)` (ADR-0033's accepted
trade-off, the same non-uniqueness stance ADR-0019 took for
`Release.version_label`). The `IntegrityError` -> `422` branch below therefore
only ever fires for a genuinely malformed row (e.g. a `NULL` in a non-nullable
column), never for a duplicate name.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.crud_factory import _org_membership_exists, chain_resolver
from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission
from app.models.actor import AIAgent, User
from app.models.planning import Environment, TestCycle, TestPlan
from app.models.project import Release
from app.schemas.planning import CreateTestCycleRequest, TestCycleSummary

router = APIRouter()

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."
_PLAN_NOT_FOUND_MESSAGE = "Test plan not found."
_RELEASE_NOT_FOUND_MESSAGE = "Release not found."
_ENVIRONMENT_NOT_FOUND_MESSAGE = "Environment not found."
_RELEASE_CROSS_PROJECT_MESSAGE = "This release belongs to a different project."
_ENVIRONMENT_CROSS_PROJECT_MESSAGE = "This environment belongs to a different project."

# The exact resolver expressions `planning.py`'s `_TEST_PLAN_CONFIG`/
# `_ENVIRONMENT_CONFIG` and `releases.py` already use, reused rather than
# re-derived: `TestPlan`, `Release` and `Environment` all carry `project_id`
# directly, so the hop list is empty and `resolve_terminal_org_id` does the
# `project_id` -> `Project.org_id` step.
_resolve_test_plan_org_id = chain_resolver([])
_resolve_release_org_id = chain_resolver([])
_resolve_environment_org_id = chain_resolver([])


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


@router.post(
    "/test-plans/{id}/test-cycles",
    response_model=TestCycleSummary,
    status_code=201,
)
async def create_test_cycle_for_plan(
    id: UUID,
    payload: CreateTestCycleRequest,
    actor: User | AIAgent = Depends(get_current_actor),
    db: AsyncSession = Depends(get_db),
) -> TestCycleSummary | JSONResponse:
    """Create a `TestCycle` under TestPlan `id` (FR-PLAN-3 AC1), ADR-0033.

    Writes exactly one row. Unlike ADR-0028/ADR-0029's atomic create+link
    routes, there is no link table involved — `release_id`/`environment_id` are
    plain FKs — which is precisely why ADR-0033 Decision #4 kept AC2's "create
    an Environment inline" as two sequential frontend calls (`POST
    /environments`, then this route) rather than inventing an atomic combined
    route: there is no atomicity property those two calls would actually lose.
    """
    plan = await db.get(TestPlan, id)
    if plan is None:
        return _error(404, "not_found", _PLAN_NOT_FOUND_MESSAGE)

    org_id = await _resolve_test_plan_org_id(db, plan)
    if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
        return _error(404, "not_found", _PLAN_NOT_FOUND_MESSAGE)

    if not await has_permission(str(actor.actor_id), str(org_id), "test_cycle.create"):
        return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

    # --- release_id: 404 (missing / other org) then 422 (same org, other project)
    release = await db.get(Release, payload.release_id)
    if release is None:
        return _error(404, "not_found", _RELEASE_NOT_FOUND_MESSAGE)
    release_org_id = await _resolve_release_org_id(db, release)
    if release_org_id is None or release_org_id != org_id:
        return _error(404, "not_found", _RELEASE_NOT_FOUND_MESSAGE)
    if release.project_id != plan.project_id:
        return _error(422, "validation_error", _RELEASE_CROSS_PROJECT_MESSAGE)

    # --- environment_id: the byte-identical three-way check, deliberately its
    # own branch over its own row (see module docstring / TC-PLAN-016).
    environment = await db.get(Environment, payload.environment_id)
    if environment is None:
        return _error(404, "not_found", _ENVIRONMENT_NOT_FOUND_MESSAGE)
    environment_org_id = await _resolve_environment_org_id(db, environment)
    if environment_org_id is None or environment_org_id != org_id:
        return _error(404, "not_found", _ENVIRONMENT_NOT_FOUND_MESSAGE)
    if environment.project_id != plan.project_id:
        return _error(422, "validation_error", _ENVIRONMENT_CROSS_PROJECT_MESSAGE)

    test_cycle = TestCycle(
        test_plan_id=plan.id,
        release_id=release.id,
        environment_id=environment.id,
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(test_cycle)
    try:
        await db.flush()
    except IntegrityError:
        # Mirrors `crud_factory.create_item`'s posture: a malformed row is
        # caught at the DB rather than pre-checked with extra queries. Note
        # this can never be a duplicate-name conflict — no such constraint
        # exists (module docstring).
        await db.rollback()
        return _error(422, "validation_error", "Request failed validation.")

    await db.commit()
    await db.refresh(test_cycle)

    return TestCycleSummary(
        id=test_cycle.id,
        test_plan_id=test_cycle.test_plan_id,
        release_id=test_cycle.release_id,
        environment_id=test_cycle.environment_id,
        name=test_cycle.name,
        start_date=test_cycle.start_date,
        end_date=test_cycle.end_date,
    )


__all__ = ["router"]
