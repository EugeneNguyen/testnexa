"""MCP-6/ADR-0068: the single entity-action registry the MCP per-entity
tools (`app/mcp/tools/entity_tools.py`) and — indirectly, since it's built
straight off `ALL_ENTITY_CONFIGS`/`CrudEntityConfig.methods` — the REST
surface read as their shared source of truth for "which methods exist for
this entity."

`TOOL_REGISTRY: dict[str, dict[str, Callable]]` is keyed by the **singular,
snake_case** `CrudEntityConfig.resource` value — the literal `resource="..."`
string each `app/api/routes/*.py` cluster module already declares
(`"organization"`, `"project"`, `"test_case"`, ...). ADR-0068 changed this
from ADR-0065's original plural-hyphenated `_resource_path()` key: with one
MCP tool generated *per entity per action* (`tn_<resource>_<action>` —
`tn_project_create`, `tn_test_case_update`), the registry key is no longer a
runtime `resource` argument a client passes, it is the identifier baked into
every generated tool's own name, and a tool name cannot contain a hyphen
segment without reading as two words. `ENTITY_CONFIGS_BY_RESOURCE` below
re-keys `ALL_ENTITY_CONFIGS` the same way; the plural slug stays untouched
wherever REST itself uses it (`GET /entities/{resource}/schema`, the
frontend's own `:entity` route segment).

Each inner value is an async **executor** sharing one uniform call signature
regardless of whether it dispatches onto a generic-factory handler or a
bespoke route:

    async def executor(*, actor, db, item_id=None, fields=None, scope=None,
                        filters=None, search=None, sort=None, page=1,
                        page_size=25, **_ignored) -> BaseModel | Response | JSONResponse

`**_ignored` lets every executor accept the full uniform kwarg set without
each one needing to declare (and immediately discard) the arguments it
doesn't use — `_generic_get`, for instance, cares only about `item_id`.

**Generic rows** come from `get_crud_handlers(config)` for every entity in
`ALL_ENTITY_CONFIGS` (ADR-0022/ADR-0055) — the exact same route-handler
closures FastAPI itself dispatches to, introspected rather than
reimplemented (see that function's own docstring) — plus a `describe` row
for every entity that has a `CrudEntityConfig` at all (wrapping ADR-0055's
`derive_entity_schema`, the identical body `GET /entities/{resource}/schema`
returns). **Bespoke rows** are declared explicitly below for the routes API
Document §4 documents that the generic factory doesn't (or doesn't fully)
serve — `TestCase` (2 create paths + the nested direct-link `list`),
`TestCondition`, `TestExecution`, `TestCycle`, `Defect`, `TestLog`
(comment), `Project` (`get`/`update`/`create`), `Organization`,
`OrgMembership` (invite), `RoleAssignment`, `Release`, and the two
join-table "add" routes (`TestSuiteTestCase`, `TestPlanTestSuite`) — each
dispatched the same `Depends`-bypass way ADR-0033's MCP-1 established,
just parameterized by a small `build_kwargs`-shaped executor instead of a
per-tool `@mcp.tool()` function.

`BESPOKE_EXTRA_ACTIONS` below declares, per entity, exactly which registry
actions come from a bespoke route rather than from `full_methods` — it is
the allow-list `tests/unit/test_mcp_tool_naming.py`'s completeness diff
subtracts before asserting registry-vs-`full_methods` equality, so adding a
bespoke executor without declaring it there (or declaring one that no longer
exists) fails that test rather than silently widening the MCP surface.

**Excluded on purpose** (Story MCP-5's own AC, ADR-0065 Decision §2):
`/auth/*`, `/invites/{token}/accept`, `/orgs/{org_id}/members/{id}/accept`
— human-identity/token flows, not agent-actionable data CRUD; and
`/orgs/{org_id}/agents` — `AIAgent` credential management is MCP-4's own
human-only screen, not a capability this MCP surface hands an agent over
itself.

**One narrow exception (ADR-0090):** `GET /agents/me/orgs` — deliberately
*not* under `/auth/*` (it's `AIAgent`-only, the exact inverse gate of
`/auth/me/orgs`'s human-only one), and needed because nothing else on this
MCP surface lets an agent discover which org(s) it may act within before
calling any org-scoped list route. `agent_org: {"list": ...}` below.

A future new bespoke mutating route or a `CrudEntityConfig.methods` change
needs one edit here (a new bespoke executor + its `BESPOKE_EXTRA_ACTIONS`
row, or nothing at all for a generic-factory `methods` change —
`get_crud_handlers` re-derives itself from the config every time this module
is imported, and `entity_tools.py` generates its tool set straight off this
registry) — never a second, independently-kept tool definition on the MCP
side (`backend/CLAUDE.md`'s new same-commit convention).
"""

import functools
import types
from collections.abc import Callable
from typing import Any
from uuid import UUID

from fastapi.responses import JSONResponse

from app.api.crud_factory import CrudEntityConfig, derive_entity_schema, get_crud_handlers
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.api.routes.agents import agent_me_orgs
from app.api.routes.assets import (
    _TEST_CASE_CONFIG,
    create_test_case_for_requirement,
    link_test_case_to_requirement,
    list_test_cases_for_requirement,
)
from app.api.routes.execution import add_test_execution_comment, raise_defect_for_execution
from app.api.routes.execution_authoring import create_execution_for_cycle
from app.api.routes.org_memberships import invite_member
from app.api.routes.organizations import create_org
from app.api.routes.projects import create_project, get_project, update_project
from app.api.routes.releases import create_release
from app.api.routes.role_assignments import create_role_assignment
from app.api.routes.test_condition_authoring import (
    create_test_case_for_test_condition,
    create_test_condition_for_requirement,
)
from app.api.routes.test_cycle_creation import create_test_cycle_for_plan
from app.api.routes.test_plan_membership import include_suite_in_plan
from app.api.routes.test_suite_membership import add_test_case_to_suite
from app.api.routes.trace import (
    link_defect_to_test_case,
    link_test_case_to_requirement_trace,
    link_test_case_to_test_condition,
    link_test_condition_to_requirement,
)
from app.models.actor import AIAgent, User
from app.schemas.assets import (
    CreateStandaloneTestCaseRequest,
    CreateTestCaseForTestConditionRequest,
    CreateTestCaseRequest,
    CreateTestConditionForRequirementRequest,
    LinkTestCaseToRequirementRequest,
)
from app.schemas.execution import (
    AddTestLogCommentRequest,
    CreateDefectForExecutionRequest,
    CreateExecutionForCycleRequest,
)
from app.schemas.org_memberships import InviteMemberRequest
from app.schemas.organizations import CreateOrgRequest
from app.schemas.projects import CreateProjectRequest, UpdateProjectRequest
from app.schemas.planning import CreateTestCycleRequest
from app.schemas.rbac import CreateRoleAssignmentRequest
from app.schemas.releases import CreateReleaseRequest

Actor = "User | AIAgent"


def _error(status_code: int, code: str, message: str, field_errors: dict[str, list[str]] | None = None) -> JSONResponse:
    """Mirrors every other module's own `_error()` verbatim (`crud_factory.py`'s
    own docstring: each module keeps its own copy per this repo's established
    convention, rather than a shared import)."""
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "field_errors": field_errors})


def _missing(field: str) -> JSONResponse:
    return _error(422, "validation_error", "Request failed validation.", field_errors={field: [f"{field} is required."]})


def unsupported_method_response() -> JSONResponse:
    """Same body Starlette's own routing emits for a matched path with no
    handler registered for the requested HTTP method.

    Under ADR-0068's per-entity tool surface this is now mostly a *defensive*
    response rather than a routinely-reachable one: an entity/action pair
    outside the registry no longer has a `tn_<resource>_<action>` tool to call
    at all, so the SDK rejects it as an unknown tool before any executor runs
    (the strictly stronger version of MCP-5's own "MCP never grants a
    capability REST doesn't have" AC — the capability isn't merely refused,
    it is never advertised). Kept because the generic executors still guard on
    a missing handler, and because it is the shape the registry promises."""
    return JSONResponse(status_code=405, content={"detail": "Method Not Allowed"})


def unknown_entity_response(resource: str) -> JSONResponse:
    """Same body `GET /entities/{resource}/schema` gives for an unregistered
    slug (`app/api/routes/entity_schema.py`) — one description of "this
    resource doesn't exist" shared by both routes. Same defensive-only status
    as `unsupported_method_response` above since ADR-0068."""
    return _error(404, "not_found", f'Unknown entity "{resource}".')


# --- generic-factory executors (dispatch onto `get_crud_handlers(config)`) -------------------


async def _generic_list(
    config: CrudEntityConfig,
    handlers: dict[str, Any],
    *,
    actor: Any,
    db: Any,
    scope: dict[str, Any] | None = None,
    filters: dict[str, Any] | None = None,
    search: str | None = None,
    sort: str | None = None,
    page: int = 1,
    page_size: int = 25,
    **_ignored: Any,
) -> Any:
    handler = handlers.get("list")
    if handler is None:
        return unsupported_method_response()
    query_params: dict[str, str] = {}
    for source in (scope, filters):
        if source:
            query_params.update({k: str(v) for k, v in source.items()})
    if search:
        query_params["q"] = search
    if sort:
        query_params["sort"] = sort
    # `list_items` only ever reads `.query_params` off its `request: Request`
    # parameter (`get_crud_handlers`'s own docstring) — a plain dict-backed
    # stand-in satisfies every `.get()`/`[]` access `apply_filters_and_search`/
    # `extract_scope_value`/`apply_sort` make against it.
    request_stub = types.SimpleNamespace(query_params=query_params)
    return await handler(request=request_stub, page=page, page_size=page_size, actor=actor, db=db)


async def _generic_get(
    config: CrudEntityConfig, handlers: dict[str, Any], *, actor: Any, db: Any, item_id: UUID | None = None, **_ignored: Any
) -> Any:
    handler = handlers.get("get")
    if handler is None or item_id is None:
        return unsupported_method_response() if handler is None else _missing("id")
    return await handler(id=item_id, actor=actor, db=db)


async def _generic_create(
    config: CrudEntityConfig, handlers: dict[str, Any], *, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any
) -> Any:
    handler = handlers.get("create")
    if handler is None:
        return unsupported_method_response()
    payload = config.create_schema(**(fields or {}))
    return await handler(payload=payload, actor=actor, db=db)


async def _generic_update(
    config: CrudEntityConfig,
    handlers: dict[str, Any],
    *,
    actor: Any,
    db: Any,
    item_id: UUID | None = None,
    fields: dict[str, Any] | None = None,
    **_ignored: Any,
) -> Any:
    handler = handlers.get("update")
    if handler is None:
        return unsupported_method_response()
    if item_id is None:
        return _missing("id")
    payload = config.update_schema(**(fields or {}))
    return await handler(id=item_id, payload=payload, actor=actor, db=db)


async def _generic_delete(
    config: CrudEntityConfig, handlers: dict[str, Any], *, actor: Any, db: Any, item_id: UUID | None = None, **_ignored: Any
) -> Any:
    handler = handlers.get("delete")
    if handler is None:
        return unsupported_method_response()
    if item_id is None:
        return _missing("id")
    return await handler(id=item_id, actor=actor, db=db)


async def _generic_describe(config: CrudEntityConfig, **_ignored: Any) -> Any:
    """`tn_<resource>_describe` — the identical body ADR-0055's
    `GET /entities/{resource}/schema` returns, derived from the same
    `derive_entity_schema(config)` call that route uses, never a second,
    drifted description of the same config. Registered for every entity that
    has a `CrudEntityConfig` at all, and only those: the three 100%-bespoke
    resources (`release`, `test_suite_test_case`, `test_plan_test_suite`)
    have no config to describe, exactly as `GET /entities/releases/schema`
    itself 404s."""
    return derive_entity_schema(config)


def _build_generic_registry() -> dict[str, dict[str, Callable]]:
    registry: dict[str, dict[str, Callable]] = {}
    for config in ALL_ENTITY_CONFIGS.values():
        handlers = get_crud_handlers(config)
        entry: dict[str, Callable] = {}
        if "list" in handlers:
            entry["list"] = functools.partial(_generic_list, config, handlers)
        if "get" in handlers:
            entry["get"] = functools.partial(_generic_get, config, handlers)
        if "create" in handlers:
            entry["create"] = functools.partial(_generic_create, config, handlers)
        if "update" in handlers:
            entry["update"] = functools.partial(_generic_update, config, handlers)
        if "delete" in handlers:
            entry["delete"] = functools.partial(_generic_delete, config, handlers)
        entry["describe"] = functools.partial(_generic_describe, config)
        registry[config.resource] = entry
    return registry


# --- bespoke executors (dispatch onto a named bespoke route handler) -------------------------


async def _test_case_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    """`test_case`'s three create paths (direct-link / rigor-path / standalone,
    ADR-0069), the same dispatch shape ADR-0033/MCP-1's own `create_test_case`
    tool established for the first two (that tool itself is retired by
    ADR-0068/MCP-6 — folded into `tn_test_case_create`, this executor):
    dispatched on a non-null `test_condition_id`, then `requirement_id`, then
    falling back to the newly-enabled generic-factory create (REQ-5's standalone
    path, `project_id` scoped) — introspected via `get_crud_handlers`
    (`backend/CLAUDE.md`'s "handler produced inside a factory function has
    no importable name" note), since this bespoke row's own override of
    `test_case`'s `create` entry in `TOOL_REGISTRY` would otherwise shadow
    the generic one the registry-build step already enabled."""
    data = dict(fields or {})
    requirement_id = data.pop("requirement_id", None)
    test_condition_id = data.pop("test_condition_id", None)
    if test_condition_id is not None:
        payload = CreateTestCaseForTestConditionRequest(**data)
        return await create_test_case_for_test_condition(id=test_condition_id, payload=payload, actor=actor, db=db)
    if requirement_id is not None:
        payload = CreateTestCaseRequest(**data)
        return await create_test_case_for_requirement(id=requirement_id, payload=payload, actor=actor, db=db)
    if "project_id" in data:
        handler = get_crud_handlers(_TEST_CASE_CONFIG)["create"]
        payload = CreateStandaloneTestCaseRequest(**data)
        return await handler(payload=payload, actor=actor, db=db)
    return _missing("requirement_id")


async def _test_case_link_requirement(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    """`POST /test-cases/{id}/link-requirement` (REQ-5, ADR-0069) — retrofit
    an existing standalone `TestCase` onto a `Requirement`. Both ids travel
    in `fields` (same shape `_test_suite_test_case_create` already
    establishes for a junction/action resource, not a plain entity `create`)
    — a 100%-bespoke pseudo-resource (no `CrudEntityConfig`), same posture
    `test_suite_test_case`/`test_plan_test_suite` already have, generating
    its own `tn_test_case_link_requirement_create` tool (MCP-6/ADR-0068's
    per-entity-per-action naming, superseding this docstring's own earlier
    "reachable via `create_entity`" framing from ADR-0065's single generic
    dispatch tool)."""
    data = dict(fields or {})
    test_case_id = data.get("test_case_id")
    requirement_id = data.get("requirement_id")
    if test_case_id is None:
        return _missing("test_case_id")
    if requirement_id is None:
        return _missing("requirement_id")
    payload = LinkTestCaseToRequirementRequest(requirement_id=requirement_id)
    return await link_test_case_to_requirement(id=test_case_id, payload=payload, actor=actor, db=db)


async def _test_case_list(
    *,
    actor: Any,
    db: Any,
    scope: dict[str, Any] | None = None,
    page: int = 1,
    page_size: int = 25,
    **_ignored: Any,
) -> Any:
    """`test_case` has **two** independent list routes REST serves, and both
    fold into this one `tn_test_case_list` slot the same way `_test_case_create`
    already dispatches three create paths through one `tn_test_case_create`
    slot — branching on which key `scope` carries, not on a `resource`
    argument. `requirement_id` set -> REQ-2's bespoke nested list (`GET
    /requirements/{id}/test-cases`), ADR-0033's MCP-1 hand-wired
    `list_test_cases(requirement_id=...)` tool folded in here by ADR-0068.
    `project_id` set -> REQ-5/ADR-0069's newly-enabled generic-factory list
    (`GET /test-cases?project_id=...`, the standalone-authoring path) —
    introspected via `get_crud_handlers` for the same reason
    `_test_case_create`'s own standalone branch does (`backend/CLAUDE.md`'s
    "handler produced inside a factory function has no importable name"
    note), since `_BESPOKE_EXECUTORS["test_case"]["list"]` (this function)
    overrides whatever `_build_generic_registry` would otherwise have
    registered for `test_case`'s own now-enabled generic `list` — without
    this branch, REQ-5's `project_id`-scoped list would be silently
    unreachable over MCP even though REST serves it."""
    data = dict(scope or {})
    requirement_id = data.get("requirement_id")
    if requirement_id is not None:
        return await list_test_cases_for_requirement(id=requirement_id, page=page, page_size=page_size, actor=actor, db=db)
    if "project_id" in data:
        handler = get_crud_handlers(_TEST_CASE_CONFIG)["list"]
        return await _generic_list(_TEST_CASE_CONFIG, {"list": handler}, actor=actor, db=db, scope=data, page=page, page_size=page_size)
    return _missing("requirement_id")


async def _test_condition_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    requirement_id = data.pop("requirement_id", None)
    if requirement_id is None:
        return _missing("requirement_id")
    payload = CreateTestConditionForRequirementRequest(**data)
    return await create_test_condition_for_requirement(id=requirement_id, payload=payload, actor=actor, db=db)


async def _test_execution_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    test_cycle_id = data.pop("test_cycle_id", None)
    if test_cycle_id is None:
        return _missing("test_cycle_id")
    payload = CreateExecutionForCycleRequest(**data)
    return await create_execution_for_cycle(id=test_cycle_id, payload=payload, actor=actor, db=db)


async def _defect_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    test_execution_id = data.pop("test_execution_id", None)
    if test_execution_id is None:
        return _missing("test_execution_id")
    payload = CreateDefectForExecutionRequest(**data)
    return await raise_defect_for_execution(id=test_execution_id, payload=payload, actor=actor, db=db)


async def _test_log_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    """`test_log`'s only create path — `POST /executions/{id}/comments`
    (EXEC-2). No plain `create` exists for `TestLog` any other way."""
    data = dict(fields or {})
    test_execution_id = data.pop("test_execution_id", None)
    if test_execution_id is None:
        return _missing("test_execution_id")
    payload = AddTestLogCommentRequest(**data)
    return await add_test_execution_comment(id=test_execution_id, payload=payload, actor=actor, db=db)


async def _project_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    org_id = data.pop("org_id", None)
    if org_id is None:
        return _missing("org_id")
    payload = CreateProjectRequest(**data)
    request_stub = types.SimpleNamespace(path_params={"org_id": org_id})
    return await create_project(org_id=org_id, payload=payload, request=request_stub, actor=actor, db=db)


async def _project_get(*, actor: Any, db: Any, item_id: UUID | None = None, **_ignored: Any) -> Any:
    if item_id is None:
        return _missing("id")
    return await get_project(id=item_id, actor=actor, db=db)


async def _project_update(*, actor: Any, db: Any, item_id: UUID | None = None, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    if item_id is None:
        return _missing("id")
    payload = UpdateProjectRequest(**(fields or {}))
    return await update_project(id=item_id, payload=payload, actor=actor, db=db)


async def _organization_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    payload = CreateOrgRequest(**(fields or {}))
    return await create_org(payload=payload, actor=actor, db=db)


async def _org_membership_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    org_id = data.pop("org_id", None)
    if org_id is None:
        return _missing("org_id")
    payload = InviteMemberRequest(**data)
    request_stub = types.SimpleNamespace(path_params={"org_id": org_id})
    return await invite_member(org_id=org_id, payload=payload, request=request_stub, actor=actor, db=db)


async def _role_assignment_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    org_id = data.pop("org_id", None)
    if org_id is None:
        return _missing("org_id")
    payload = CreateRoleAssignmentRequest(**data)
    request_stub = types.SimpleNamespace(path_params={"org_id": org_id})
    return await create_role_assignment(org_id=org_id, payload=payload, request=request_stub, actor=actor, db=db)


async def _release_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    """`Release` has no `CrudEntityConfig` at all (100% bespoke, API Doc §4) —
    `create` is the only method registered here, matching REST's own reality
    exactly (no plain `get`/`update`/`delete` route exists to mirror)."""
    data = dict(fields or {})
    project_id = data.pop("project_id", None)
    if project_id is None:
        return _missing("project_id")
    payload = CreateReleaseRequest(**data)
    return await create_release(project_id=project_id, payload=payload, actor=actor, db=db)


async def _test_cycle_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    test_plan_id = data.pop("test_plan_id", None)
    if test_plan_id is None:
        return _missing("test_plan_id")
    payload = CreateTestCycleRequest(**data)
    return await create_test_cycle_for_plan(id=test_plan_id, payload=payload, actor=actor, db=db)


async def _agent_org_list(*, actor: Any, db: Any, **_ignored: Any) -> Any:
    """ADR-0090: the calling `AIAgent`'s own active-org self-discovery — the
    one MCP-reachable exception to ADR-0065 Decision §2's `/auth/*` exclusion,
    since it's a new route (`GET /agents/me/orgs`) outside that prefix, not a
    widening of it. No `scope`/`filters`/`fields`/pagination — identity-scoped,
    same posture `GET /auth/me/orgs` takes for a human caller."""
    return await agent_me_orgs(actor=actor, db=db)


async def _test_suite_test_case_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    suite_id = data.get("test_suite_id")
    case_id = data.get("test_case_id")
    if suite_id is None:
        return _missing("test_suite_id")
    if case_id is None:
        return _missing("test_case_id")
    return await add_test_case_to_suite(id=suite_id, case_id=case_id, actor=actor, db=db)


async def _test_plan_test_suite_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    data = dict(fields or {})
    plan_id = data.get("test_plan_id")
    suite_id = data.get("test_suite_id")
    if plan_id is None:
        return _missing("test_plan_id")
    if suite_id is None:
        return _missing("test_suite_id")
    return await include_suite_in_plan(id=plan_id, suite_id=suite_id, actor=actor, db=db)


def _link_create_executor(handler: Callable, first_field: str, second_field: str) -> Callable:
    """Build the `create` executor for one of ADR-0076's four traceability-link routes.

    All four `POST`s take exactly two path ids and no body, so all four
    executors are the same three lines with different field names — the shape
    `_test_suite_test_case_create`/`_test_plan_test_suite_create` above each
    hand-write. Built from a factory here rather than written out four more
    times, because four independently-typed copies of "read two keys off
    `fields`, `_missing()` whichever is absent" is exactly how one of them ends
    up reporting the wrong field name.

    `first_field`/`second_field` are the link row's own FK column names, in the
    same order the route's path segments carry them — which is also the order
    `CrudEntityConfig.link_create.path_template` names them, so the MCP tool
    and the REST URL cannot disagree about which id is which.
    """

    async def _execute(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
        data = dict(fields or {})
        first = data.get(first_field)
        second = data.get(second_field)
        if first is None:
            return _missing(first_field)
        if second is None:
            return _missing(second_field)
        return await handler(id=first, **{second_field: second}, actor=actor, db=db)

    return _execute


_requirement_test_case_link_create = _link_create_executor(
    link_test_case_to_requirement_trace, "requirement_id", "test_case_id"
)
_requirement_test_condition_link_create = _link_create_executor(
    link_test_condition_to_requirement, "requirement_id", "test_condition_id"
)
_test_condition_test_case_link_create = _link_create_executor(
    link_test_case_to_test_condition, "test_condition_id", "test_case_id"
)
_test_case_defect_link_create = _link_create_executor(
    link_defect_to_test_case, "test_case_id", "defect_id"
)


_BESPOKE_EXECUTORS: dict[str, dict[str, Callable]] = {
    "test_case": {"create": _test_case_create, "list": _test_case_list},
    "test_condition": {"create": _test_condition_create},
    "test_execution": {"create": _test_execution_create},
    "defect": {"create": _defect_create},
    "test_log": {"create": _test_log_create},
    "project": {"create": _project_create, "get": _project_get, "update": _project_update},
    "organization": {"create": _organization_create},
    "org_membership": {"create": _org_membership_create},
    "role_assignment": {"create": _role_assignment_create},
    "release": {"create": _release_create},
    "test_cycle": {"create": _test_cycle_create},
    "test_suite_test_case": {"create": _test_suite_test_case_create},
    "test_plan_test_suite": {"create": _test_plan_test_suite_create},
    # REQ-5/ADR-0069: a 100%-bespoke pseudo-resource, same posture as
    # `test_suite_test_case`/`test_plan_test_suite` above (no `CrudEntityConfig`,
    # one action) — generates `tn_test_case_link_requirement_create`.
    "test_case_link_requirement": {"create": _test_case_link_requirement},
    # ADR-0076: the four traceability links gain a real `create` over MCP too,
    # same one-action shape as the two junctions above. Each entity's own
    # `CrudEntityConfig` stays `{"list","get"}`, so `create` is an "extra" and
    # is declared in `BESPOKE_EXTRA_ACTIONS` below.
    "requirement_test_case_link": {"create": _requirement_test_case_link_create},
    "requirement_test_condition_link": {"create": _requirement_test_condition_link_create},
    "test_condition_test_case_link": {"create": _test_condition_test_case_link_create},
    "test_case_defect_link": {"create": _test_case_defect_link_create},
    # ADR-0090: 100%-bespoke pseudo-resource, same posture as
    # `test_case_link_requirement` above (no `CrudEntityConfig`, one action) —
    # generates `tn_agent_org_list`, the calling AIAgent's own org self-discovery.
    "agent_org": {"list": _agent_org_list},
}

#: Per entity, the actions this registry serves that are NOT already claimed by
#: that entity's own `CrudEntityConfig.full_methods` (ADR-0053 — the field that
#: answers "what can REST actually do with this entity", the one
#: `derive_entity_schema` itself uses, and the one `backend/CLAUDE.md`'s own
#: registry-completeness note requires any parity diff to compare against).
#:
#: `project` is the entity that motivated `full_methods` in the first place —
#: its bespoke `get`/`update`/`create` are all *already* declared there, so it
#: contributes no extras here despite having three bespoke executors above.
#: Everything else listed is a real bespoke route whose entity config
#: deliberately does not register that method with the generic factory
#: (`backend/CLAUDE.md`'s "audit for a matching bespoke route" convention).
#: `release`/`test_suite_test_case`/`test_plan_test_suite`/
#: `test_case_link_requirement` have no `CrudEntityConfig` at all, so 100% of
#: their surface is an "extra".
#:
#: `tests/unit/test_mcp_tool_naming.py` asserts this dict exactly equals the
#: registry's own surplus over `full_methods` — a bespoke executor added
#: without a row here (or a row here with no executor) fails that test.
BESPOKE_EXTRA_ACTIONS: dict[str, frozenset[str]] = {
    "test_case": frozenset({"create", "list"}),
    "test_condition": frozenset({"create"}),
    "test_execution": frozenset({"create"}),
    "defect": frozenset({"create"}),
    "test_log": frozenset({"create"}),
    "organization": frozenset({"create"}),
    "org_membership": frozenset({"create"}),
    "role_assignment": frozenset({"create"}),
    "test_cycle": frozenset({"create"}),
    "release": frozenset({"create"}),
    "test_suite_test_case": frozenset({"create"}),
    "test_plan_test_suite": frozenset({"create"}),
    "test_case_link_requirement": frozenset({"create"}),
    # ADR-0076 — `create` on each of the four traceability links. Unlike the
    # config-less rows above, these four DO have a `CrudEntityConfig`, whose
    # `methods` stays `{"list","get"}` because the generic factory still
    # registers no create for them; the create is one bespoke route each.
    "requirement_test_case_link": frozenset({"create"}),
    "requirement_test_condition_link": frozenset({"create"}),
    "test_condition_test_case_link": frozenset({"create"}),
    "test_case_defect_link": frozenset({"create"}),
    "agent_org": frozenset({"list"}),
}


def _build_registry() -> dict[str, dict[str, Callable]]:
    registry = _build_generic_registry()
    for resource, executors in _BESPOKE_EXECUTORS.items():
        registry.setdefault(resource, {}).update(executors)
    return registry


TOOL_REGISTRY: dict[str, dict[str, Callable]] = _build_registry()

#: `ALL_ENTITY_CONFIGS` re-keyed by the same singular `resource` slug
#: `TOOL_REGISTRY` uses, so a per-entity tool generator never has to translate
#: between the two spellings. The three 100%-bespoke resources are absent here
#: (no `CrudEntityConfig` exists for them) and therefore get no `describe` tool.
ENTITY_CONFIGS_BY_RESOURCE: dict[str, CrudEntityConfig] = {config.resource: config for config in ALL_ENTITY_CONFIGS.values()}

#: The complete action vocabulary. Order is deliberate — it is the order
#: `entity_tools.py` registers tools in, so `tools/list` reads coherently
#: per entity (read verbs, then write verbs, then reflection).
ACTIONS: tuple[str, ...] = ("list", "get", "create", "update", "delete", "describe")

#: Every generated MCP tool name carries this prefix. It namespaces the 146
#: tools this server publishes against whatever *other* MCP servers a client
#: has mounted at the same time (ADR-0068 Decision §3) — an unprefixed
#: `project_create` would be an obvious collision candidate in any multi-server
#: client session; `tn_` (TestNexa) is not.
TOOL_NAME_PREFIX = "tn_"


def tool_name(resource: str, action: str) -> str:
    """`tn_<resource>_<action>` — e.g. `tool_name("test_case", "update")` →
    `"tn_test_case_update"`. The single place this string is built; every
    other module (the generator, its tests) calls this rather than
    re-concatenating, so the scheme has exactly one definition."""
    return f"{TOOL_NAME_PREFIX}{resource}_{action}"


__all__ = [
    "ACTIONS",
    "BESPOKE_EXTRA_ACTIONS",
    "ENTITY_CONFIGS_BY_RESOURCE",
    "TOOL_NAME_PREFIX",
    "TOOL_REGISTRY",
    "tool_name",
    "unknown_entity_response",
    "unsupported_method_response",
]
