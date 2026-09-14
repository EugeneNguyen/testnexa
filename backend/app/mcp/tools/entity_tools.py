"""MCP-6/ADR-0067: one MCP tool **per entity per supported action**, named
`tn_<resource>_<action>` — `tn_organization_get`, `tn_project_create`,
`tn_requirement_list`, `tn_test_case_update`, ...

Replaces ADR-0065's six reflective, `resource`-parameterised tools
(`list_entities`/`get_entity`/`create_entity`/`update_entity`/
`delete_entity`/`describe_entity`) **and** ADR-0033/MCP-1's two hand-wired
`create_test_case`/`list_test_cases` tools, which fold into this scheme as
`tn_test_case_create`/`tn_test_case_list` with no duplicate or conflicting
name. Nothing about the *dispatch* changes: every tool generated here calls
the exact same `app/mcp/tool_registry.py` executor its reflective predecessor
called, which in turn direct-calls the same REST route handler
(`backend/CLAUDE.md`'s `Depends`-bypass pattern, ADR-0033 decision 2). The
change is entirely in how the surface is *advertised*.

Why per-entity tools at all (ADR-0067 Decision §1): a `resource: str`
parameter is a value the model has to get right from prose, with no schema
to check it against — an invalid slug fails at call time, and nothing in
`tools/list` tells a client which of the ~30 slugs actually support `create`.
One tool per real capability moves all of that into the tool list itself: the
name *is* the entity, the presence of the tool *is* the capability, and each
tool's input schema carries only the arguments that action genuinely takes
(no `resource`). MCP-5's "MCP never grants a capability REST doesn't have"
AC gets strictly stronger — an unsupported entity/action pair is not refused
at call time, it is never advertised.

The cost, stated plainly: 146 tools instead of 8. See ADR-0067's
Consequences for the trade-off discussion.

**Generation is data-driven, never hand-listed.** The (entity, action) pairs
come from `TOOL_REGISTRY` itself; a new bespoke route or a
`CrudEntityConfig.methods` change produces its tool automatically, and
`tests/unit/test_mcp_tool_naming.py`'s diff proves the generated set matches
each entity's own `full_methods` (plus its declared
`BESPOKE_EXTRA_ACTIONS`) exactly, with nothing orphaned.
"""

import json
from typing import Any
from uuid import UUID

from fastapi import Response
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import ValidationError

from app.api.crud_factory import _display_name
from app.db.session import AsyncSessionLocal
from app.mcp.auth import resolve_agent_from_header
from app.mcp.tool_registry import (
    ACTIONS,
    ENTITY_CONFIGS_BY_RESOURCE,
    TOOL_REGISTRY,
    tool_name,
)


def _raise_as_tool_error(response: JSONResponse) -> None:
    """Same translation ADR-0033 decision 4 established — the API Document §1
    `{code, message, field_errors}` envelope, serialized verbatim into
    FastMCP's `ToolError` text, so an MCP client's `code`/`field_errors`
    pattern-match works identically to a REST caller's."""
    payload = json.loads(response.body)
    raise ToolError(json.dumps(payload))


def _materialize(result: Any) -> dict[str, Any]:
    """Normalize every shape a registry executor can return into the plain
    dict an MCP tool hands back on success.

    Four shapes exist across this codebase's route handlers (not a defect to
    fix here — pre-existing, verified against each handler's own return type
    before writing this): a Pydantic model (`get_item`/`create_item`/
    `create_project`/...), a `JSONResponse` used for *both* errors (4xx/5xx)
    *and* some bespoke routes' own success body (`add_test_case_to_suite`/
    `include_suite_in_plan`'s `201` — no Pydantic model, per FR-REQ-4/PLAN-1),
    a plain no-content `Response` (`delete_item`'s `204`), and — since
    ADR-0067 folded `describe` into the registry — a plain `dict` already in
    its final wire shape (`derive_entity_schema`'s return). Distinguish
    error-vs-success `JSONResponse` by status code, not type alone.
    """
    if isinstance(result, JSONResponse):
        if result.status_code >= 400:
            _raise_as_tool_error(result)
        return json.loads(result.body)
    if isinstance(result, Response):
        return {"status": "deleted"}
    if isinstance(result, dict):
        return result
    return result.model_dump(mode="json")


def _validation_error_response(exc: ValidationError) -> JSONResponse:
    """A `fields` dict that fails the entity's own `create_schema`/
    `update_schema` (missing required field, malformed `UUID`, bad enum value,
    ...) raises a raw `pydantic.ValidationError` — MCP tools build these
    schemas from an untyped `fields: dict[str, Any]` themselves, so FastAPI's
    own `RequestValidationError` handler (`app/main.py`) never sees it (it
    only ever fires during FastAPI's own request-body parsing, which this call
    never goes through). Mirrors that handler's exact `loc`-based
    `field_errors` extraction so the envelope is identical either way."""
    field_errors: dict[str, list[str]] = {}
    for error in exc.errors():
        loc = error.get("loc", ())
        field = str(loc[-1]) if loc else "__root__"
        field_errors.setdefault(field, []).append(error.get("msg", "Invalid value."))
    return JSONResponse(status_code=422, content={"code": "validation_error", "message": "Request failed validation.", "field_errors": field_errors})


async def _run(resource: str, action: str, **kwargs: Any) -> dict[str, Any]:
    """The one body every generated tool shares: resolve the calling `AIAgent`
    from the bearer header, open a fresh `AsyncSession`, invoke this
    (entity, action)'s registry executor, normalize the result.

    `resource`/`action` are closed over by the generator rather than passed by
    the client — that is the whole point of ADR-0067 (the entity is the tool's
    identity, not one of its arguments)."""
    executor = TOOL_REGISTRY[resource][action]
    async with AsyncSessionLocal() as db:
        try:
            result = await executor(db=db, **kwargs)
        except ValidationError as exc:
            result = _validation_error_response(exc)
    return _materialize(result)


# --- description generation ------------------------------------------------------------------
#
# Every generated tool carries a hand-quality description (FastMCP hands it to
# the client verbatim in `tools/list`) — this is the only surface a model has
# to decide *which* of 146 tools to call, so it names the entity, the REST
# route it mirrors, and any parent id the bespoke path needs. Built once at
# import time, not per call.

#: The parent id(s) a bespoke `create` route takes as a REST *path* parameter,
#: which an MCP caller supplies inside `fields` instead. Hand-declared because
#: it is a property of each bespoke route's URL shape, not of any config.
#: `tests/unit/test_mcp_tool_naming.py` asserts this covers exactly the
#: entities whose `create` is bespoke — no more, no less.
BESPOKE_CREATE_PARENT_FIELDS: dict[str, str | None] = {
    "test_case": '"requirement_id" (REQ-2 direct-link path) or "test_condition_id" (REQ-3 rigor path)',
    "test_condition": '"requirement_id"',
    "test_execution": '"test_cycle_id"',
    "defect": '"test_execution_id"',
    "test_log": '"test_execution_id"',
    "project": '"org_id"',
    "organization": None,
    "org_membership": '"org_id"',
    "role_assignment": '"org_id"',
    "release": '"project_id"',
    "test_cycle": '"test_plan_id"',
    "test_suite_test_case": '"test_suite_id" and "test_case_id"',
    "test_plan_test_suite": '"test_plan_id" and "test_suite_id"',
}

#: Entities whose `list` is a bespoke nested route rather than the generic
#: factory's flat one — the `scope` key that route needs as its path parameter.
BESPOKE_LIST_SCOPE_FIELDS: dict[str, str] = {
    "test_case": "requirement_id",
}


def _entity_label(resource: str) -> str:
    """The entity's own plural display label — `CrudEntityConfig.label`
    (ADR-0053, the exact string the admin nav shows) where one exists,
    `_display_name` otherwise for the three config-less bespoke resources."""
    config = ENTITY_CONFIGS_BY_RESOURCE.get(resource)
    if config is not None and config.label:
        return config.label
    return _display_name(resource)


def _singular(resource: str) -> str:
    """`"test_case"` → `"test case"`. Used wherever a sentence needs a singular
    noun — `CrudEntityConfig.label` is always plural ("Test cases"), so reusing
    it for "Create a ... row" reads wrong."""
    return resource.replace("_", " ")


def _scope_hint(resource: str) -> str:
    if resource in BESPOKE_LIST_SCOPE_FIELDS:
        field = BESPOKE_LIST_SCOPE_FIELDS[resource]
        return f' `scope` is REQUIRED and must carry {{"{field}": "<uuid>"}} — this list is a nested REST route, not a flat one.'
    config = ENTITY_CONFIGS_BY_RESOURCE.get(resource)
    if config is None or config.scope_field is None:
        return " This entity is unscoped (a global catalog or org-root list); `scope` may be omitted."
    if isinstance(config.scope_field, tuple):
        options = " or ".join(f'{{"{f}": "<uuid>"}}' for f in config.scope_field)
        return f" `scope` must carry exactly one of {options} — supplying both, or neither, is the same 422 REST gives."
    return f' `scope` must carry {{"{config.scope_field}": "<uuid>"}}, the same query param the REST list route requires.'


def _describe_action(resource: str, action: str) -> str:
    label = _entity_label(resource)
    one = _singular(resource)
    if action == "list":
        text = f"List {label}.{_scope_hint(resource)}"
        text += (
            " `filters`/`search` (REST's own `?q=`)/`sort` (`field` or `-field`) and `page`/`page_size` "
            "mirror the REST list route's query params verbatim; the response is the standard "
            "{items, total, page, page_size} envelope."
        )
        if resource in ENTITY_CONFIGS_BY_RESOURCE:
            text += f" Call `{tool_name(resource, 'describe')}` to learn this entity's own field names."
        return text
    if action == "get":
        return (
            f"Fetch one {one} by `id`, from {label}. Same validation, permission check and cross-tenant "
            f"404-not-403 boundary (NFR-1) the REST GET route performs."
        )
    if action == "create":
        parent = BESPOKE_CREATE_PARENT_FIELDS.get(resource)
        bespoke = resource in BESPOKE_CREATE_PARENT_FIELDS
        base = f"Create one {one}. `fields` matches the entity's own create payload"
        if resource in ENTITY_CONFIGS_BY_RESOURCE:
            base += f" — call `{tool_name(resource, 'describe')}` first to learn its required fields"
        base += "."
        if bespoke:
            base += (
                " This entity's real create path is a bespoke REST route rather than the generic factory, "
                "so every business rule that route enforces applies identically here"
            )
            if parent:
                base += f", and `fields` must additionally carry {parent} — the id(s) that route takes as URL path parameters"
            base += "."
        return base
    if action == "update":
        return (
            f"Partially update one {one} by `id`. Only the keys present in `fields` change; same validation, "
            f"permission check, tenant boundary and — where the entity configures one — the same business-rule "
            f"`update_guard`/`post_update_hook` the REST PATCH route runs."
        )
    if action == "delete":
        return (
            f"Delete one {one} by `id`. Same permission check and tenant boundary as the REST DELETE route, "
            f"including the same `409 restrict_blocked` when the row is still referenced by a RESTRICT foreign key."
        )
    if action == "describe":
        return (
            f"Return the field shape of {label} (names, types, required flags, enum values, FK references, "
            f"sortable flags) — the identical body `GET /entities/{{resource}}/schema` returns (ADR-0055), "
            f"not a second description that could drift from it. Takes no arguments."
        )
    raise AssertionError(f"unknown action {action!r}")  # pragma: no cover


# --- tool factories --------------------------------------------------------------------------
#
# One factory per action. Each returns a fresh `async def` whose signature
# carries *only* that action's real arguments — FastMCP derives each tool's
# input schema straight from these annotations, so `tn_requirement_get` shows
# a client exactly `{id}` and `tn_requirement_list` exactly
# `{scope, filters, search, sort, page, page_size}`. No `resource` argument
# exists on any of them; it is closed over here.


def _make_list_tool(resource: str):
    async def _list(
        scope: dict[str, str] | None = None,
        filters: dict[str, str] | None = None,
        search: str | None = None,
        sort: str | None = None,
        page: int = 1,
        page_size: int = 25,
        ctx: Context = None,  # type: ignore[assignment]
    ) -> dict[str, Any]:
        agent = await resolve_agent_from_header(ctx)
        return await _run(
            resource, "list", actor=agent, scope=scope, filters=filters, search=search, sort=sort, page=page, page_size=page_size
        )

    return _list


def _make_get_tool(resource: str):
    async def _get(id: UUID, ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        agent = await resolve_agent_from_header(ctx)
        return await _run(resource, "get", actor=agent, item_id=id)

    return _get


def _make_create_tool(resource: str):
    async def _create(fields: dict[str, Any], ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        agent = await resolve_agent_from_header(ctx)
        return await _run(resource, "create", actor=agent, fields=fields)

    return _create


def _make_update_tool(resource: str):
    async def _update(id: UUID, fields: dict[str, Any], ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        agent = await resolve_agent_from_header(ctx)
        return await _run(resource, "update", actor=agent, item_id=id, fields=fields)

    return _update


def _make_delete_tool(resource: str):
    async def _delete(id: UUID, ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        agent = await resolve_agent_from_header(ctx)
        return await _run(resource, "delete", actor=agent, item_id=id)

    return _delete


def _make_describe_tool(resource: str):
    async def _describe(ctx: Context = None) -> dict[str, Any]:  # type: ignore[assignment]
        # Auth is still required — the schema surface is not public — but the
        # resolved agent is unused: `derive_entity_schema` reads a static
        # config, touches no row and needs no tenant.
        await resolve_agent_from_header(ctx)
        return await _run(resource, "describe", actor=None)

    return _describe


_FACTORIES = {
    "list": _make_list_tool,
    "get": _make_get_tool,
    "create": _make_create_tool,
    "update": _make_update_tool,
    "delete": _make_delete_tool,
    "describe": _make_describe_tool,
}


def generated_tool_names() -> list[str]:
    """Every `tn_<resource>_<action>` name this module registers, in
    registration order. Derived from `TOOL_REGISTRY` — the single place the
    expected set is computed, so the completeness test can't drift from the
    generator by re-deriving the list its own way."""
    names: list[str] = []
    for resource in sorted(TOOL_REGISTRY):
        for action in ACTIONS:
            if action in TOOL_REGISTRY[resource]:
                names.append(tool_name(resource, action))
    return names


def register_tools(mcp) -> None:
    """Generate and register one tool per (entity, action) row in
    `TOOL_REGISTRY`, via `mcp.add_tool(fn, name=..., description=...)`.

    `add_tool` rather than the `@mcp.tool()` decorator because the name and
    description are computed per entity — the decorator only takes a literal
    at the definition site, which is exactly the hand-listing this module
    exists to avoid. Registration order is entity-alphabetical, then
    `ACTIONS` order within an entity, so a client's `tools/list` reads
    coherently rather than in dict-insertion order.
    """
    for resource in sorted(TOOL_REGISTRY):
        for action in ACTIONS:
            if action not in TOOL_REGISTRY[resource]:
                continue
            name = tool_name(resource, action)
            fn = _FACTORIES[action](resource)
            # FastMCP titles the tool's derived argument model after
            # `fn.__name__` — leave the factory's own `_list`/`_get`/... and
            # all 146 tools publish an identically-titled `_listArguments`
            # schema, which reads like a bug in any client that surfaces the
            # title. Stamp the real tool name on instead.
            fn.__name__ = name
            mcp.add_tool(fn, name=name, description=_describe_action(resource, action))
