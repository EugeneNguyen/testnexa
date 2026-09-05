"""API-1: generic CRUD router factory (ADR-0021).

`make_crud_router(config)` registers whichever of `list`/`get`/`create`/
`update`/`delete` are named in `config.methods` as flat, row-resolved routes
(`/{resource}s`, `/{resource}s/{id}`) for a single entity — called once per
entity from each cluster route module (`app/api/routes/assets.py`,
`planning.py`, `taxonomy.py`, `governance.py`, `rbac_routes.py`,
`execution.py`, plus a handful of routes bolted onto the existing
`organizations.py`/`projects.py`/`org_memberships.py` modules), never
subclassed — composition over inheritance, matching FastAPI's own
function/dependency-based idiom (ADR-0021's Alternatives section).

**Item routes** (`GET`/`PATCH`/`DELETE /{resource}/{id}`) are flat — no
`org_id`/`project_id` path segment — so they fetch the row first, resolve its
`org_id` via `config.resolve_org_id`, apply the any-status-`OrgMembership`
404-vs-403 boundary (`projects.py`/`releases.py`'s established pattern), then
call `has_permission` directly. `require_permission` (`app/core/rbac.py`)
reads `org_id`/`project_id` off *path* params and doesn't fit this flat shape
(ADR-0021 Context #2) — every route built here calls `has_permission`
directly instead, same posture `projects.py`'s own row-resolved routes
already established.

**Global-catalog entities** (`config.scope_field is None`, e.g.
`TestDesignTechnique`/`TestLevel`/`TestType`/`Permission`) have no tenant to
boundary-check at all — `has_permission_in_any_org` gates their list/create,
and `config.is_global_catalog=True` makes item routes use the same gate
whenever `resolve_org_id` returns `None` (which, for these entities, is
always — `resolve_org_id` is a constant-`None` function, never a per-row
resolution failure).

**Distinguishing "statically global" from "this particular row's chain
resolved to `None`"** is the whole point of the `is_global_catalog`/
`global_read_fallback` flags (ADR-0021 edge case #1): a tenant-owned row
whose FK chain can't be walked (e.g. an orphaned `TestCase`, or a multi-hop
`Defect` chain missing an intermediate row) must `404`, exactly like a
missing/cross-tenant row — it must NOT silently fall back to the
any-org gate meant for entities that never had a tenant in the first place.
`Role.org_id IS NULL` (a system-role template, Q3) is the one deliberate
exception: readable via the any-org fallback on `GET` only
(`global_read_fallback=True`), `404` on `PATCH`/`DELETE` — this asymmetry is
`Role`-specific, not a generic "read is always more permissive" rule.

**List/create routes require the entity's own scope FK explicitly**
(`config.scope_field`) — a query param on `list`, a body field on `create`,
never inferred; missing it is `422`, not an empty/degraded result.
`scope_field` is usually a single column name, but `RiskItem`'s branching
`requirement_id` **or** `test_plan_id` shape (exactly one, per its own `CHECK`
constraint) doesn't fit a single string — `scope_field` additionally accepts
a 2-tuple of alternative field names for exactly this case (a typing
generalization of ADR-0021's dataclass sketch, not a new behavior: the ADR's
own prose and the API Document's §3 resolver table both already specify
"exactly one, both set -> 422" for `RiskItem` specifically).

**DELETE's flush-then-catch-`IntegrityError` maps to `409 restrict_blocked`**
— a RESTRICT-blocked FK is a different failure class than create/update's
`422` (a well-formed request blocked by a still-referencing child row, not a
malformed one).
"""

import enum
import types
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, create_model
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db
from app.core.rbac import has_permission, has_permission_in_any_org
from app.db.base import Base
from app.models.actor import AIAgent, User
from app.models.assets import Requirement, TestCase, TestCondition, TestSuite, TestSuiteTestCase
from app.models.planning import TestPlan
from app.models.project import Project
from app.models.tenancy import OrgMembership

# API Document §1: offset-based pagination, default/max page_size = 25 (NFR-6)
# — same constants `releases.py` already uses verbatim.
_DEFAULT_PAGE_SIZE = 25
_MAX_PAGE_SIZE = 25

_PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action."

# Model columns this factory auto-stamps with the acting actor's id on
# `create`, never accepted from the request body — currently only
# `TestPlan.created_by_actor_id` is create-registered and carries one of
# these (`TestCase`/`Defect` also have an equivalent column but neither
# registers `create` via this factory, ADR-0021).
_ACTOR_STAMPED_FIELDS: tuple[str, ...] = ("created_by_actor_id",)

# `entry_exit_criteria` is already grammatically plural ("criteria") — the
# one exception to "resource.replace('_', '-') + 's'" among this factory's 20
# entities (verified against every path the API Document §3/§4 names).
_PLURAL_PATH_EXCEPTIONS: dict[str, str] = {"entry_exit_criteria": "entry-exit-criteria"}

ScopeField = str | tuple[str, str] | None
ResolveOrgId = Callable[[AsyncSession, Any], Awaitable[uuid.UUID | None]]


class _NoSchema(BaseModel):
    """Placeholder `update_schema` for an entity that never registers `update`.

    `CrudEntityConfig.update_schema` has no default (ADR-0021's dataclass
    sketch lists it as a required field) — entities like `Permission` (`list`/
    `get` only) still need to satisfy the type, so they pass this rather than
    a real per-entity schema that would never be bound to a route.
    """


@dataclass
class CrudEntityConfig:
    """Per-entity configuration consumed by `make_crud_router` (ADR-0021).

    Field list matches the ADR's own sketch verbatim, plus two additions the
    ADR's prose requires but its dataclass sketch didn't literally spell out
    by name (`is_global_catalog`, `global_read_fallback`) — see this module's
    own docstring for why both are necessary, not merely convenient.
    """

    model: type[Base]
    resource: str
    create_schema: type[BaseModel] | None
    update_schema: type[BaseModel]
    summary_schema: type[BaseModel]
    scope_field: ScopeField
    resolve_org_id: ResolveOrgId
    search_fields: tuple[str, ...] = ()
    filter_fields: tuple[str, ...] = ()
    methods: frozenset[str] = field(default_factory=lambda: frozenset({"list", "get", "create", "update", "delete"}))
    # True for entities with no tenant at all (TestDesignTechnique/TestLevel/
    # TestType/Permission): `resolve_org_id` is a constant-`None` function,
    # and item routes gate via `has_permission_in_any_org` unconditionally
    # whenever it returns `None` (which, for these, is always).
    is_global_catalog: bool = False
    # True only for `Role`: `GET` on a `org_id IS NULL` row falls back to
    # `has_permission_in_any_org` (Q3/edge case 2); `PATCH`/`DELETE` still
    # `404`. Meaningless unless `is_global_catalog` is False.
    global_read_fallback: bool = False


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape.

    Mirrors every existing route module's own `_error()` verbatim — this
    factory keeps its own copy per that established per-module convention.
    """
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


async def _org_membership_exists(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Any-status `OrgMembership` existence check for the 404-vs-403 boundary.

    Mirrors `projects.py`/`releases.py`/`org_memberships.py`'s helper of the
    same name verbatim (NFR-1: any-status counts, not just active).
    """
    result = await db.scalar(
        select(OrgMembership.id).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id).limit(1)
    )
    return result is not None


# --- resolve_org_id building blocks (ADR-0021's resolver map) --------------------------------


async def resolve_terminal_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Resolve a row that should carry `org_id` directly, or `project_id` (one further hop).

    The shared "last step" every `chain_resolver` walk ends on: most entities
    either have their own `org_id` column (`Role`/`OrgMembership`/
    `RoleAssignment`, or a `Project`/`Organization` row reached by an earlier
    hop) or a `project_id` column one hop from `Project.org_id`
    (`Requirement`/`TestSuite`/`Environment`/`TestPlan`, or a row reached by
    an earlier hop that itself has one). `getattr(..., None)` throughout so
    this also works against a `types.SimpleNamespace` stand-in carrying only
    the one scope-FK attribute a list/create scope check has available (see
    `extract_scope_value`) — not just a real ORM instance.
    """
    org_id = getattr(row, "org_id", None)
    if org_id is not None:
        return org_id
    project_id = getattr(row, "project_id", None)
    if project_id is None:
        return None
    project = await db.get(Project, project_id)
    return project.org_id if project is not None else None


def chain_resolver(hops: Sequence[tuple[type, str]]) -> ResolveOrgId:
    """Build a `resolve_org_id(db, row)` that walks `hops` via `db.get`, then resolves the terminal row.

    Each hop is `(ParentModel, fk_column_name)`: read `fk_column_name` off
    the current row, `db.get(ParentModel, that_value)`, and continue from
    there. An empty `hops` list resolves `row` itself via
    `resolve_terminal_org_id` — the "direct column" case (`Requirement`,
    `OrgMembership`, ...). A missing FK value or a hop that resolves to no
    row at all short-circuits to `None` (unresolvable chain -> the caller
    404s, never a partial/guessed result).
    """

    async def _resolve(db: AsyncSession, row: Any) -> uuid.UUID | None:
        current: Any = row
        for parent_model, fk_column in hops:
            fk_value = getattr(current, fk_column, None)
            if fk_value is None:
                return None
            current = await db.get(parent_model, fk_value)
            if current is None:
                return None
        return await resolve_terminal_org_id(db, current)

    return _resolve


async def resolve_test_case_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Bespoke `TestCase` resolver (ADR-0021): nullable-hop with a link-table fallback.

    `test_condition_id` (if set) -> `TestCondition.requirement_id` ->
    `Requirement.project_id` -> `Project.org_id`. If `test_condition_id` is
    `None` (ADR-0006), falls back to any linked `TestSuiteTestCase` ->
    `TestSuite.project_id` -> `Project.org_id`. A `TestCase` reachable by
    neither path resolves `None` — genuinely orphaned (schema-legal, no
    create path in this codebase produces it) — the caller must treat this as
    "unresolvable tenant", i.e. `404`, never the any-org global-catalog
    fallback (ADR-0021 edge case #1; `is_global_catalog=False` on `TestCase`'s
    own config makes that distinction automatically).
    """
    test_condition_id = getattr(row, "test_condition_id", None)
    if test_condition_id is not None:
        condition = await db.get(TestCondition, test_condition_id)
        if condition is None:
            return None
        requirement = await db.get(Requirement, condition.requirement_id)
        if requirement is None:
            return None
        return await resolve_terminal_org_id(db, requirement)

    row_id = getattr(row, "id", None)
    if row_id is None:
        return None
    link = await db.scalar(select(TestSuiteTestCase).where(TestSuiteTestCase.test_case_id == row_id).limit(1))
    if link is None:
        return None
    suite = await db.get(TestSuite, link.test_suite_id)
    if suite is None:
        return None
    return await resolve_terminal_org_id(db, suite)


async def resolve_via_test_case(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Shared by `TestStep`/`Attachment`: one hop to `TestCase`, then delegate.

    `TestCase`'s own resolver is bespoke (branching + fallback), not a plain
    FK-to-`org_id`/`project_id` terminal, so this can't be expressed as a
    `chain_resolver` hop — it fetches the real `TestCase` row and hands it to
    `resolve_test_case_org_id` directly.
    """
    test_case_id = getattr(row, "test_case_id", None)
    if test_case_id is None:
        return None
    test_case = await db.get(TestCase, test_case_id)
    if test_case is None:
        return None
    return await resolve_test_case_org_id(db, test_case)


async def resolve_risk_item_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Bespoke `RiskItem` resolver (ADR-0021): branch on whichever FK is set.

    `RiskItem`'s own `CHECK` constraint only requires "at least one of
    `requirement_id`/`test_plan_id`" (an `OR`, not `XOR`) — the factory's
    `create_schema`/scope-validation layer enforces "exactly one" before a
    row can ever exist with both set via this API (edge case #5), so this
    resolver only ever needs to pick whichever single FK is actually
    present. `getattr(..., None)` (not direct attribute access) so this also
    works against a `types.SimpleNamespace` scope stand-in that only carries
    ONE of the two attributes (see `extract_scope_value`).
    """
    requirement_id = getattr(row, "requirement_id", None)
    if requirement_id is not None:
        requirement = await db.get(Requirement, requirement_id)
        if requirement is None:
            return None
        return await resolve_terminal_org_id(db, requirement)

    test_plan_id = getattr(row, "test_plan_id", None)
    if test_plan_id is not None:
        test_plan = await db.get(TestPlan, test_plan_id)
        if test_plan is None:
            return None
        return await resolve_terminal_org_id(db, test_plan)

    return None


async def resolve_organization_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """`Organization`'s own resolver: the row IS the tenant, `id` IS `org_id`.

    `Organization` has no `org_id`/`project_id` column of its own (only `id`)
    so `resolve_terminal_org_id`'s generic attribute lookup doesn't apply —
    this is the one entity where "id is itself the scope" (API Document §3).
    """
    return getattr(row, "id", None)


async def resolve_global_org_id(db: AsyncSession, row: Any) -> uuid.UUID | None:
    """Constant-`None` resolver for true global catalogs (no tenant, ever).

    Used by `TestDesignTechnique`/`TestLevel`/`TestType`/`Permission`
    (`is_global_catalog=True` on all four) — distinguished from a *row*
    resolving to `None` (see this module's own docstring, edge case #1).
    """
    return None


# --- scope-field helpers (list/create) --------------------------------------------------------


def _scope_candidates(config: CrudEntityConfig) -> tuple[str, ...]:
    if config.scope_field is None:
        return ()
    if isinstance(config.scope_field, tuple):
        return config.scope_field
    return (config.scope_field,)


def extract_scope_value(config: CrudEntityConfig, source: Mapping[str, Any]) -> tuple[str, Any] | None:
    """Pick the single present scope field + value out of `source`.

    `source` is either `request.query_params` (`list`) or a create payload's
    `model_dump()` (`create`). Returns `None` — the caller then 422s via
    `scope_validation_error` — when zero or more than one of the candidate
    fields is present: for a plain single-field `scope_field` that's simply
    "missing"; for `RiskItem`'s 2-tuple shape, "more than one present"
    collapses the DB `CHECK` constraint's `OR` down to the API's own
    "exactly one" rule (ADR-0021 edge case #5), applied identically on `list`
    and `create` (API Document §3's resolver table states the "exactly one"
    rule for the scope param generally, not create-only).
    """
    candidates = _scope_candidates(config)
    if not candidates:
        return None
    present = [(f, source.get(f)) for f in candidates if source.get(f) not in (None, "")]
    if len(present) != 1:
        return None
    return present[0]


def scope_validation_error(config: CrudEntityConfig, source: Mapping[str, Any]) -> JSONResponse:
    """Build the `422` for a missing/ambiguous scope value (see `extract_scope_value`)."""
    candidates = _scope_candidates(config)
    primary_field = candidates[0]
    present_count = sum(1 for f in candidates if source.get(f) not in (None, ""))

    if len(candidates) == 1:
        field_errors = {primary_field: [f"{primary_field} is required."]}
    elif present_count == 0:
        field_errors = {primary_field: [f"exactly one of {' or '.join(candidates)} must be set"]}
    else:
        field_errors = {primary_field: [f"exactly one of {' or '.join(candidates)} must be set, not both"]}

    return _error(422, "validation_error", "Request failed validation.", field_errors=field_errors)


# --- list query-building (pure, no DB access — unit-testable) --------------------------------


def apply_filters_and_search(
    query: Any,
    model: type[Base],
    filter_fields: tuple[str, ...],
    search_fields: tuple[str, ...],
    query_params: Mapping[str, Any],
) -> Any:
    """Translate `filter_fields`/`?q=` query params into `WHERE` clauses on `query`.

    `filter_fields` are exact-match (`WHERE column = value` for each param
    actually present); `search_fields`, if configured, back a single `?q=`
    param compiled to `OR`-joined `ILIKE '%term%'` across those columns. An
    entity with no `search_fields` configured silently ignores `?q=` rather
    than erroring (ADR-0021) — `q` is only ever consulted when `search_fields`
    is non-empty. Pure query-building: never executes anything, so this is
    testable without a DB (`tests/unit/test_crud_factory.py`).
    """
    for column_name in filter_fields:
        if query_params.get(column_name) not in (None, ""):
            query = query.where(getattr(model, column_name) == query_params[column_name])

    search_term = query_params.get("q")
    if search_term and search_fields:
        query = query.where(or_(*[getattr(model, f).ilike(f"%{search_term}%") for f in search_fields]))

    return query


def clamp_pagination(page: int, page_size: int, max_page_size: int = _MAX_PAGE_SIZE) -> tuple[int, int]:
    """Clamp `page`/`page_size` to the API Document §1/NFR-6 convention.

    `page` floors at 1; `page_size` floors at 1 and ceilings at
    `max_page_size` (25 by default, same as `releases.py`'s own list route).
    Pure function — unit-testable without a DB.
    """
    return max(page, 1), min(max(page_size, 1), max_page_size)


# --- row <-> schema mapping -------------------------------------------------------------------


def _to_summary(config: CrudEntityConfig, row: Any) -> BaseModel:
    """Build `config.summary_schema` off `row`'s own attributes, by field name.

    Every schema in this factory's cluster files names its fields identically
    to the ORM column they mirror, so a plain by-name `getattr` covers every
    entity generically — no per-entity mapping function needed (unlike the
    bespoke `_release_summary`/`_member_summary` helpers in `releases.py`/
    `org_memberships.py`, which exist precisely because THEIR shapes don't
    map 1:1, e.g. a joined `User.email`). SQLAlchemy `Enum` columns store a
    Python `str` `Enum` member (`TestCaseStatus.draft`, etc.) — `.value` is
    extracted explicitly rather than relying on `str, Enum`'s implicit str
    behavior, matching `releases.py`'s own explicit `.value if hasattr(...)`
    precedent for `TestExecutionResult`.
    """
    data: dict[str, Any] = {}
    for field_name in config.summary_schema.model_fields:
        value = getattr(row, field_name, None)
        if isinstance(value, enum.Enum):
            value = value.value
        data[field_name] = value
    return config.summary_schema(**data)


def _build_list_response_schema(summary_schema: type[BaseModel]) -> type[BaseModel]:
    """Build the `{items, total, page, page_size}` envelope model for `summary_schema`.

    Built dynamically via `pydantic.create_model` rather than requiring a
    `list_response_schema` field on `CrudEntityConfig` — keeps the config
    dataclass exactly matching ADR-0021's own field list (schema files still
    define an explicit `<Entity>ListResponse` per the plan, for OpenAPI/type-
    generation consumers, but this factory doesn't need to be handed one to
    wire the route: same JSON shape either way).
    """
    return create_model(
        f"{summary_schema.__name__}ListResponse",
        items=(list[summary_schema], ...),
        total=(int, ...),
        page=(int, ...),
        page_size=(int, ...),
    )


# --- path/display-name helpers -----------------------------------------------------------------


def _resource_path(resource: str) -> str:
    """`"test_condition"` -> `"test-conditions"` (API Document §3/§4 path convention)."""
    if resource in _PLURAL_PATH_EXCEPTIONS:
        return _PLURAL_PATH_EXCEPTIONS[resource]
    return resource.replace("_", "-") + "s"


def _display_name(resource: str) -> str:
    """`"test_condition"` -> `"Test condition"` (for `"{name} not found."` bodies)."""
    return resource.replace("_", " ").capitalize()


# --- the factory itself -----------------------------------------------------------------------


def make_crud_router(config: CrudEntityConfig) -> APIRouter:
    """Build an `APIRouter` registering whichever of `config.methods` are configured.

    See this module's own docstring for the shared gating/resolution
    behavior every route below shares.
    """
    router = APIRouter()
    resource = config.resource
    model = config.model
    path = _resource_path(resource)
    display_name = _display_name(resource)
    list_response_schema = _build_list_response_schema(config.summary_schema) if "list" in config.methods else None

    async def _fetch_and_gate(
        db: AsyncSession, actor: User | AIAgent, item_id: uuid.UUID, action: str
    ) -> tuple[Any, JSONResponse | None]:
        """Fetch `model` row `item_id`, resolve its org, apply the 404-vs-403 boundary.

        Shared by `get`/`update`/`delete` — only `action` (`"read"`/
        `"update"`/`"delete"`) differs between call sites, both for the
        `{resource}.{action}` permission code and for whether a `None`
        `resolve_org_id` result falls back to `has_permission_in_any_org`
        (see this module's own docstring on `is_global_catalog`/
        `global_read_fallback`).
        """
        row = await db.get(model, item_id)
        if row is None:
            return None, _error(404, "not_found", f"{display_name} not found.")

        org_id = await config.resolve_org_id(db, row)
        if org_id is None:
            if config.is_global_catalog or (action == "read" and config.global_read_fallback):
                if not await has_permission_in_any_org(str(actor.actor_id), f"{resource}.{action}"):
                    return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
                return row, None
            return None, _error(404, "not_found", f"{display_name} not found.")

        if not await _org_membership_exists(db, org_id, actor.actor_id):
            return None, _error(404, "not_found", f"{display_name} not found.")
        if not await has_permission(str(actor.actor_id), str(org_id), f"{resource}.{action}"):
            return None, _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)

        return row, None

    async def _resolve_scope_for_write(
        db: AsyncSession, actor: User | AIAgent, data: Mapping[str, Any], action: str
    ) -> JSONResponse | None:
        """Shared `create`/list-scope gate: resolve+404-vs-403+permission on the scope value.

        Returns an error `JSONResponse` if any check fails, `None` if the
        caller may proceed. `data` supplies the scope field's already-parsed
        value (a real `UUID`, not a query string — `list`'s caller parses the
        raw query-string value into a `UUID` itself first, see `list_items`).
        """
        scope = extract_scope_value(config, data)
        if scope is None:
            return scope_validation_error(config, data)
        field_name, raw_value = scope
        org_id = await config.resolve_org_id(db, types.SimpleNamespace(**{field_name: raw_value}))
        if org_id is None or not await _org_membership_exists(db, org_id, actor.actor_id):
            return _error(404, "not_found", f"{display_name} not found.")
        if not await has_permission(str(actor.actor_id), str(org_id), f"{resource}.{action}"):
            return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
        return None

    # --- list -----------------------------------------------------------------------------

    if "list" in config.methods:
        assert list_response_schema is not None

        async def list_items(
            request: Request,
            page: int = 1,
            page_size: int = _DEFAULT_PAGE_SIZE,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            query_params = request.query_params
            query = select(model)

            if config.scope_field is None:
                if not await has_permission_in_any_org(str(actor.actor_id), f"{resource}.read"):
                    return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
            else:
                scope = extract_scope_value(config, query_params)
                if scope is None:
                    return scope_validation_error(config, query_params)
                field_name, raw_value = scope
                try:
                    scope_uuid = uuid.UUID(str(raw_value))
                except (ValueError, TypeError, AttributeError):
                    return _error(
                        422,
                        "validation_error",
                        "Request failed validation.",
                        field_errors={field_name: ["must be a valid UUID"]},
                    )
                error = await _resolve_scope_for_write(db, actor, {field_name: scope_uuid}, "read")
                if error is not None:
                    return error
                query = query.where(getattr(model, field_name) == scope_uuid)

            query = apply_filters_and_search(query, model, config.filter_fields, config.search_fields, query_params)

            page_c, page_size_c = clamp_pagination(page, page_size)
            total = await db.scalar(select(func.count()).select_from(query.subquery()))
            result = await db.execute(query.offset((page_c - 1) * page_size_c).limit(page_size_c))
            rows = result.scalars().all()

            return list_response_schema(
                items=[_to_summary(config, row) for row in rows],
                total=total or 0,
                page=page_c,
                page_size=page_size_c,
            )

        router.add_api_route(f"/{path}", list_items, methods=["GET"], response_model=list_response_schema)

    # --- get ------------------------------------------------------------------------------

    if "get" in config.methods:

        async def get_item(
            id: uuid.UUID,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "read")
            if error is not None:
                return error
            return _to_summary(config, row)

        router.add_api_route(f"/{path}/{{id}}", get_item, methods=["GET"], response_model=config.summary_schema)

    # --- create -----------------------------------------------------------------------------

    if "create" in config.methods and config.create_schema is not None:
        CreateSchema = config.create_schema

        async def create_item(
            payload: CreateSchema,  # type: ignore[valid-type]
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            data = payload.model_dump(exclude_none=True)

            if config.scope_field is None:
                if not await has_permission_in_any_org(str(actor.actor_id), f"{resource}.create"):
                    return _error(403, "permission_denied", _PERMISSION_DENIED_MESSAGE)
            else:
                error = await _resolve_scope_for_write(db, actor, data, "create")
                if error is not None:
                    return error

            for stamped_field in _ACTOR_STAMPED_FIELDS:
                if hasattr(model, stamped_field) and stamped_field not in data:
                    data[stamped_field] = actor.actor_id

            row = model(**data)
            db.add(row)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(422, "validation_error", "Request failed validation.")

            await db.commit()
            await db.refresh(row)
            return _to_summary(config, row)

        router.add_api_route(
            f"/{path}", create_item, methods=["POST"], response_model=config.summary_schema, status_code=201
        )

    # --- update -----------------------------------------------------------------------------

    if "update" in config.methods:
        UpdateSchema = config.update_schema

        async def update_item(
            id: uuid.UUID,
            payload: UpdateSchema,  # type: ignore[valid-type]
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> BaseModel | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "update")
            if error is not None:
                return error

            updates = payload.model_dump(exclude_unset=True)
            for field_name, value in updates.items():
                setattr(row, field_name, value)

            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(422, "validation_error", "Request failed validation.")

            await db.commit()
            await db.refresh(row)
            return _to_summary(config, row)

        router.add_api_route(
            f"/{path}/{{id}}", update_item, methods=["PATCH"], response_model=config.summary_schema
        )

    # --- delete -----------------------------------------------------------------------------

    if "delete" in config.methods:

        async def delete_item(
            id: uuid.UUID,
            actor: User | AIAgent = Depends(get_current_actor),
            db: AsyncSession = Depends(get_db),
        ) -> Response | JSONResponse:
            row, error = await _fetch_and_gate(db, actor, id, "delete")
            if error is not None:
                return error

            await db.delete(row)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return _error(
                    409,
                    "restrict_blocked",
                    "This item cannot be deleted while other records still reference it.",
                )

            await db.commit()
            return Response(status_code=204)

        router.add_api_route(
            f"/{path}/{{id}}", delete_item, methods=["DELETE"], status_code=204, response_model=None
        )

    return router


__all__ = [
    "CrudEntityConfig",
    "apply_filters_and_search",
    "chain_resolver",
    "clamp_pagination",
    "extract_scope_value",
    "make_crud_router",
    "resolve_global_org_id",
    "resolve_organization_org_id",
    "resolve_risk_item_org_id",
    "resolve_terminal_org_id",
    "resolve_test_case_org_id",
    "resolve_via_test_case",
    "scope_validation_error",
]
