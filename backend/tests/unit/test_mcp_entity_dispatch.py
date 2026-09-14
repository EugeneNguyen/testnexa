"""Unit tests for the MCP registry/dispatch mechanism.

Originally `test_mcp5_generic_crud.py` (ADR-0065's 6 reflective tools);
renamed and rewritten in place for ADR-0068's per-entity tool surface. The
error-shape and `_materialize` coverage is carried over verbatim — none of
that changed, only which module exposes it (`app/mcp/tools/generic_crud.py`
→ `app/mcp/tools/entity_tools.py`) and how the registry is keyed (plural
hyphenated slug → singular `resource` slug).

TC-MCP-017 (method-gating parity) is the one section that genuinely changed
shape: under ADR-0065 an unsupported entity/action pair was *refused at call
time* by `_lookup`, so the test asserted the refusal's error envelope. Under
ADR-0068 there is no such call to make — the pair has no
`tn_<resource>_<action>` tool at all, so the assertion is now "this tool is
not registered," a strictly stronger claim (the capability is never
advertised, not merely refused). The `405`/`404` response builders are kept
and still asserted, since the registry still promises those shapes and the
generic executors still guard on a missing handler.

TC-MCP-023 (registry completeness) moved out of this file entirely — it is
now the diff-based `tests/unit/test_mcp_tool_naming.py`, which covers the
whole generated surface rather than this file's original spot checks.

Pure structure/error-shape checks, no DB/network (`backend/tests/unit/`'s
own posture).
"""

from __future__ import annotations

import json

import pytest
from fastapi import Response
from fastapi.responses import JSONResponse
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel

from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.mcp.server import mcp
from app.mcp.tool_registry import (
    ENTITY_CONFIGS_BY_RESOURCE,
    TOOL_REGISTRY,
    tool_name,
    unknown_entity_response,
    unsupported_method_response,
)
from app.mcp.tools.entity_tools import _materialize


class _DummySummary(BaseModel):
    id: str


# --- registry shape (the singular-slug re-keying, ADR-0068) ----------------------------


def test_registry_is_keyed_by_the_singular_resource_slug_not_the_plural_route_slug() -> None:
    """The tool name is built straight off this key, so the key must be the
    route module's own `resource="..."` string — `"test_case"`, never
    `"test-cases"` (which would produce `tn_test-cases_get`)."""
    assert "test_case" in TOOL_REGISTRY
    assert "test-cases" not in TOOL_REGISTRY
    for key in TOOL_REGISTRY:
        assert "-" not in key, key


def test_entity_configs_by_resource_re_keys_all_entity_configs_losslessly() -> None:
    assert len(ENTITY_CONFIGS_BY_RESOURCE) == len(ALL_ENTITY_CONFIGS)
    assert {c.resource for c in ALL_ENTITY_CONFIGS.values()} == set(ENTITY_CONFIGS_BY_RESOURCE)


def test_release_has_no_generic_config_but_has_a_create_row() -> None:
    """`Release` is deliberately absent from `ALL_ENTITY_CONFIGS` (100%
    bespoke, no `CrudEntityConfig` at all) — the registry still carries its
    one real capability (`create`), and nothing else, matching REST exactly."""
    assert "release" not in ENTITY_CONFIGS_BY_RESOURCE
    assert set(TOOL_REGISTRY["release"]) == {"create"}


def test_project_has_bespoke_get_update_create_alongside_generic_list_and_delete() -> None:
    """`Project`'s own `CrudEntityConfig.methods` is `{"list","delete"}` only
    (`get`/`update`/`create` are bespoke routes, per that config's own comment
    and its `full_methods` override) — the registry's `project` row must carry
    all five, plus `describe`."""
    assert set(TOOL_REGISTRY["project"]) == {"list", "get", "create", "update", "delete", "describe"}


def test_test_case_list_is_a_bespoke_dispatcher_over_two_real_rest_list_routes() -> None:
    """MCP-1's hand-wired `list_test_cases` folds in here (ADR-0068), and
    REQ-5/ADR-0069 later gave `TestCase` a second, genuinely generic-factory
    `list` (`scope_field="project_id"`, the standalone-authoring path) —
    found merging the two branches. `tn_test_case_list` stays a single
    bespoke row either way (`_BESPOKE_EXECUTORS["test_case"]["list"]`
    overrides whatever the generic-registry builder would have registered),
    dispatching on which key `scope` carries (`requirement_id` -> REQ-2's
    nested list, `project_id` -> REQ-5's flat one) rather than exposing two
    separate tools for one entity's one action — same "one tool per entity
    per action" posture ADR-0068 established for `create`."""
    assert "list" in TOOL_REGISTRY["test_case"]
    assert "list" in ALL_ENTITY_CONFIGS["test-cases"].methods


def test_test_case_link_requirement_is_a_fourth_configless_pseudo_resource() -> None:
    """REQ-5/ADR-0069's retrofit route (`POST /test-cases/{id}/link-requirement`)
    — same posture as `release`/`test_suite_test_case`/`test_plan_test_suite`
    above: no `CrudEntityConfig` at all, one bespoke action, generating
    `tn_test_case_link_requirement_create`."""
    assert "test_case_link_requirement" not in ENTITY_CONFIGS_BY_RESOURCE
    assert set(TOOL_REGISTRY["test_case_link_requirement"]) == {"create"}


# --- TC-MCP-017: method-gating parity ---------------------------------------------------


def test_unsupported_method_response_matches_rest_405_shape() -> None:
    response = unsupported_method_response()
    assert response.status_code == 405
    assert json.loads(response.body) == {"detail": "Method Not Allowed"}


def test_unknown_entity_response_matches_entity_schema_route_404_shape() -> None:
    response = unknown_entity_response("not-a-real-entity")
    assert response.status_code == 404
    body = json.loads(response.body)
    assert body["code"] == "not_found"
    assert "not-a-real-entity" in body["message"]


def test_no_tool_exists_for_an_unknown_entity() -> None:
    """ADR-0065 answered an unknown `resource` argument with a `404` envelope.
    ADR-0068 has no `resource` argument to get wrong — the surface simply
    contains no tool for it."""
    registered = set(mcp._tool_manager._tools)
    for bogus in ("not_a_real_entity", "widget", "user"):
        assert not any(name.startswith(f"tn_{bogus}_") for name in registered), bogus


@pytest.mark.parametrize(
    ("resource", "action"),
    [
        ("test_log", "update"),  # TestLog is get/list/create(comment) only — immutable otherwise
        ("test_log", "delete"),
        ("requirement_test_case_link", "create"),  # link tables are read-only
        ("requirement_test_case_link", "update"),
        ("requirement_test_case_link", "delete"),
        ("permission", "create"),  # global catalog, read-only via the factory
        ("permission", "update"),
        ("permission", "delete"),
        ("organization", "list"),  # no flat org list route exists
        ("role_assignment", "list"),
        ("release", "get"),  # create-only bespoke resource
        ("release", "list"),
        ("release", "describe"),  # no CrudEntityConfig to describe
        ("test_suite_test_case", "list"),
    ],
)
def test_no_tool_is_generated_for_a_method_the_entity_does_not_support(resource: str, action: str) -> None:
    """MCP never grants a capability REST doesn't have — ADR-0068 enforces it
    by *omission from the tool list*, the strongest available form: a client
    cannot call what was never advertised."""
    assert action not in TOOL_REGISTRY[resource]
    assert tool_name(resource, action) not in mcp._tool_manager._tools


@pytest.mark.parametrize(
    ("resource", "action"),
    [
        ("requirement", "list"),
        ("requirement", "create"),
        ("test_case", "list"),
        ("test_case", "create"),
        ("test_log", "create"),
        ("project", "get"),
        ("project", "update"),
        ("release", "create"),
        ("test_level", "describe"),
    ],
)
def test_a_supported_method_has_both_a_registry_executor_and_a_registered_tool(resource: str, action: str) -> None:
    assert callable(TOOL_REGISTRY[resource][action])
    assert tool_name(resource, action) in mcp._tool_manager._tools


# --- `_materialize` result normalization -------------------------------------------------


def test_materialize_raises_tool_error_for_error_json_response() -> None:
    response = JSONResponse(status_code=404, content={"code": "not_found", "message": "x", "field_errors": None})
    with pytest.raises(ToolError):
        _materialize(response)


def test_materialize_decodes_success_json_response_body() -> None:
    """The `add_test_case_to_suite`/`include_suite_in_plan` shape — success is
    also a `JSONResponse` (no Pydantic model), distinguished from an error
    one by status code, not type."""
    response = JSONResponse(status_code=201, content={"test_suite_id": "abc", "test_case_id": "def"})
    assert _materialize(response) == {"test_suite_id": "abc", "test_case_id": "def"}


def test_materialize_returns_status_deleted_for_plain_204_response() -> None:
    assert _materialize(Response(status_code=204)) == {"status": "deleted"}


def test_materialize_dumps_pydantic_model() -> None:
    assert _materialize(_DummySummary(id="abc")) == {"id": "abc"}


def test_materialize_passes_a_plain_dict_through_untouched() -> None:
    """The `describe` shape, new in ADR-0068 — `derive_entity_schema` already
    returns the final wire dict, with no model to dump."""
    schema = {"resource": "requirements", "fields": [], "methods": ["list"]}
    assert _materialize(schema) is schema
