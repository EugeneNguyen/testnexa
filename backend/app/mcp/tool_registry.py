"""MCP-5/ADR-0065: the single entity-action registry both the MCP generic
tools (`app/mcp/tools/generic_crud.py`) and — indirectly, since it's built
straight off `ALL_ENTITY_CONFIGS`/`CrudEntityConfig.methods` — the REST
surface read as their shared source of truth for "which methods exist for
this entity."

`TOOL_REGISTRY: dict[str, dict[str, Callable]]` is keyed by the same
**plural, hyphenated** `resource` slug `ALL_ENTITY_CONFIGS`/
`GET /entities/{resource}/schema` already use (`app.api.crud_factory
._resource_path`), not the singular `CrudEntityConfig.resource` value — one
fewer translation for an MCP client that already called `describe_entity`
to learn the entity's shape. Each inner value is an async **executor**
sharing one uniform call signature regardless of whether it dispatches onto
a generic-factory handler or a bespoke route:

    async def executor(*, actor, db, item_id=None, fields=None, scope=None,
                        filters=None, search=None, sort=None, page=1,
                        page_size=25, **_ignored) -> BaseModel | Response | JSONResponse

`**_ignored` lets every executor accept the full uniform kwarg set without
each one needing to declare (and immediately discard) the arguments it
doesn't use — `_generic_get`, for instance, cares only about `item_id`.

**Generic rows** come from `get_crud_handlers(config)` for every entity in
`ALL_ENTITY_CONFIGS` (ADR-0022/ADR-0055) — the exact same route-handler
closures FastAPI itself dispatches to, introspected rather than
reimplemented (see that function's own docstring). **Bespoke rows** are
declared explicitly below for the mutating routes API Document §4
documents that the generic factory doesn't (or doesn't fully) serve —
`TestCase` (2 create paths), `TestCondition`, `TestExecution`, `TestCycle`,
`Defect`, `TestLog` (comment), `Project` (`get`/`update`/`create`),
`Organization`, `OrgMembership` (invite), `RoleAssignment`, `Release`, and
the two join-table "add" routes (`TestSuiteTestCase`, `TestPlanTestSuite`) — each
dispatched the same `Depends`-bypass way ADR-0033's MCP-1 established,
just parameterized by a small `build_kwargs`-shaped executor instead of a
per-tool `@mcp.tool()` function.

**Excluded on purpose** (Story MCP-5's own AC, ADR-0065 Decision §2):
`/auth/*`, `/invites/{token}/accept`, `/orgs/{org_id}/members/{id}/accept`
— human-identity/token flows, not agent-actionable data CRUD; and
`/orgs/{org_id}/agents` — `AIAgent` credential management is MCP-4's own
human-only screen, not a capability this MCP surface hands an agent over
itself.

A future new bespoke mutating route or a `CrudEntityConfig.methods` change
needs one edit here (a new bespoke executor, or nothing at all for a
generic-factory `methods` change — `get_crud_handlers` re-derives itself
from the config every time this module is imported) — never a second,
independently-kept tool definition on the MCP side (`backend/CLAUDE.md`'s
new same-commit convention).
"""

import functools
import types
from collections.abc import Callable
from typing import Any
from uuid import UUID

from fastapi.responses import JSONResponse

from app.api.crud_factory import CrudEntityConfig, _resource_path, get_crud_handlers
from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.api.routes.assets import _TEST_CASE_CONFIG, create_test_case_for_requirement, link_test_case_to_requirement
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
    handler registered for the requested HTTP method — a `create_entity`/
    `update_entity`/`delete_entity`/`list_entities`/`get_entity` call against
    a `resource`+action combination outside its registry row gets the exact
    same shape a REST client hitting the unregistered method would (Story
    MCP-5's own AC — MCP never grants a capability REST doesn't have)."""
    return JSONResponse(status_code=405, content={"detail": "Method Not Allowed"})


def unknown_entity_response(resource: str) -> JSONResponse:
    """Same body `GET /entities/{resource}/schema` gives for an unregistered
    slug (`app/api/routes/entity_schema.py`) — one description of "this
    resource doesn't exist" shared by both routes."""
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


def _build_generic_registry() -> dict[str, dict[str, Callable]]:
    registry: dict[str, dict[str, Callable]] = {}
    for resource_slug, config in ALL_ENTITY_CONFIGS.items():
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
        registry[resource_slug] = entry
    return registry


# --- bespoke executors (dispatch onto a named bespoke route handler) -------------------------


async def _test_case_create(*, actor: Any, db: Any, fields: dict[str, Any] | None = None, **_ignored: Any) -> Any:
    """`test_case`'s three create paths (direct-link / rigor-path / standalone,
    ADR-0068), same branch `app/mcp/tools/test_cases.py`'s own
    `create_test_case` MCP-1 tool already uses for the first two: dispatched
    on a non-null `test_condition_id`, then `requirement_id`, then falling
    back to the newly-enabled generic-factory create (REQ-5's standalone
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
    """`POST /test-cases/{id}/link-requirement` (REQ-5, ADR-0068) — retrofit
    an existing standalone `TestCase` onto a `Requirement`. Both ids travel
    in `fields` (same shape `_test_suite_test_case_create` already
    establishes for a junction/action resource, not a plain entity `create`)
    — reachable via `create_entity` against a dedicated
    `test_case_link_requirement` resource slug."""
    data = dict(fields or {})
    test_case_id = data.get("test_case_id")
    requirement_id = data.get("requirement_id")
    if test_case_id is None:
        return _missing("test_case_id")
    if requirement_id is None:
        return _missing("requirement_id")
    payload = LinkTestCaseToRequirementRequest(requirement_id=requirement_id)
    return await link_test_case_to_requirement(id=test_case_id, payload=payload, actor=actor, db=db)


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


_BESPOKE_CREATE: dict[str, Callable] = {
    _resource_path("test_case"): _test_case_create,
    _resource_path("test_condition"): _test_condition_create,
    _resource_path("test_execution"): _test_execution_create,
    _resource_path("defect"): _defect_create,
    _resource_path("test_log"): _test_log_create,
    _resource_path("project"): _project_create,
    _resource_path("organization"): _organization_create,
    _resource_path("org_membership"): _org_membership_create,
    _resource_path("role_assignment"): _role_assignment_create,
    _resource_path("release"): _release_create,
    _resource_path("test_cycle"): _test_cycle_create,
    _resource_path("test_suite_test_case"): _test_suite_test_case_create,
    _resource_path("test_plan_test_suite"): _test_plan_test_suite_create,
    _resource_path("test_case_link_requirement"): _test_case_link_requirement,
}


def _build_registry() -> dict[str, dict[str, Callable]]:
    registry = _build_generic_registry()
    for slug, executor in _BESPOKE_CREATE.items():
        registry.setdefault(slug, {})["create"] = executor
    project_slug = _resource_path("project")
    registry[project_slug]["get"] = _project_get
    registry[project_slug]["update"] = _project_update
    return registry


TOOL_REGISTRY: dict[str, dict[str, Callable]] = _build_registry()

__all__ = [
    "TOOL_REGISTRY",
    "unknown_entity_response",
    "unsupported_method_response",
]
