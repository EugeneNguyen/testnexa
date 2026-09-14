"""Unit tests for MCP-5's registry/dispatch mechanism (ADR-0065).

TC-MCP-017 (method-gating parity), TC-MCP-023 (registry completeness) —
pure structure/error-shape checks, no DB/network (`backend/tests/unit/`'s
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
from app.mcp.tool_registry import TOOL_REGISTRY, unknown_entity_response, unsupported_method_response
from app.mcp.tools.generic_crud import _lookup, _materialize


class _DummySummary(BaseModel):
    id: str


# --- TC-MCP-023: registry completeness --------------------------------------------------


def test_every_generic_factory_entity_has_a_registry_row() -> None:
    """Every `ALL_ENTITY_CONFIGS` slug (the generic factory's own 27 entities,
    ADR-0022/ADR-0055) must have a corresponding `TOOL_REGISTRY` row — a
    hand-authored registry can silently omit an entity the same way a
    hand-kept `entityConfigs/<entity>.ts` could drift before ADR-0055."""
    missing = set(ALL_ENTITY_CONFIGS) - set(TOOL_REGISTRY)
    assert missing == set()


def test_registry_methods_never_exceed_the_entitys_own_rest_surface() -> None:
    """MCP never grants a generic-factory entity a capability its REST
    surface doesn't already have (Story MCP-5's own AC) — compared against
    `config.full_methods` (falling back to `config.methods`), the same field
    `derive_entity_schema`/`GET /entities/{resource}/schema` (ADR-0055) uses
    to describe an entity's *true* REST-reachable methods when a bespoke
    route fills in what the generic factory itself doesn't register
    (`Project`'s own `get`/`update` are the one case today, per that field's
    own docstring)."""
    for resource, config in ALL_ENTITY_CONFIGS.items():
        registered = set(TOOL_REGISTRY[resource])
        rest_surface = config.full_methods if config.full_methods is not None else config.methods
        for verb in ("list", "get", "update", "delete"):
            if verb in rest_surface:
                assert verb in registered, f"{resource}.{verb} missing from registry"
            else:
                assert verb not in registered, f"{resource}.{verb} unexpectedly present in registry"


def test_known_bespoke_create_resources_are_present() -> None:
    """The ~13 bespoke mutating routes API Document §4 documents each have
    their own declared registry row (ADR-0065 Decision §2) — spot-check the
    full set named in that decision, not just one representative."""
    expected = {
        "test-cases",
        "test-conditions",
        "test-executions",
        "test-cycles",
        "defects",
        "test-logs",
        "projects",
        "organizations",
        "org-memberships",
        "role-assignments",
        "releases",
        "test-suite-test-cases",
        "test-plan-test-suites",
    }
    for resource in expected:
        assert resource in TOOL_REGISTRY, f"{resource} missing from registry"
        assert "create" in TOOL_REGISTRY[resource], f"{resource} has no create executor"


def test_release_has_no_generic_config_but_has_a_create_row() -> None:
    """`Release` is deliberately absent from `ALL_ENTITY_CONFIGS` (100%
    bespoke, no `CrudEntityConfig` at all) — the registry still carries its
    one real capability (`create`), and nothing else, matching REST exactly."""
    assert "releases" not in ALL_ENTITY_CONFIGS
    assert set(TOOL_REGISTRY["releases"]) == {"create"}


def test_project_has_bespoke_get_and_update_alongside_generic_list_and_delete() -> None:
    """`Project`'s own `CrudEntityConfig.methods` is `{"list","delete"}` only
    (`get`/`update` are bespoke routes at the same URL, per that config's
    own comment) — the registry's `projects` row must carry all four."""
    assert set(TOOL_REGISTRY["projects"]) == {"list", "get", "create", "update", "delete"}


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


def test_lookup_raises_tool_error_for_unknown_resource() -> None:
    with pytest.raises(ToolError) as excinfo:
        _lookup("not-a-real-entity", "list")
    payload = json.loads(excinfo.value.args[0])
    assert payload["code"] == "not_found"


@pytest.mark.parametrize(
    ("resource", "action"),
    [
        ("releases", "list"),  # Release has no generic config at all — registry only carries `create`
        ("test-logs", "update"),  # TestLog is get/list/create(comment) only — immutable otherwise
        ("test-logs", "delete"),
        ("requirement-test-case-links", "create"),  # link tables are read-only
        ("permissions", "create"),  # global catalog, read-only via the factory
    ],
)
def test_lookup_raises_tool_error_for_a_method_the_entity_does_not_register(resource: str, action: str) -> None:
    with pytest.raises(ToolError) as excinfo:
        _lookup(resource, action)
    payload = json.loads(excinfo.value.args[0])
    assert payload == {"detail": "Method Not Allowed"}


def test_lookup_succeeds_for_a_registered_method() -> None:
    executor = _lookup("requirements", "list")
    assert callable(executor)


def test_lookup_succeeds_for_test_case_list_and_create_after_req5() -> None:
    """REQ-5/ADR-0068 — `test-cases:list`/`:create` are now genuinely
    registered (the standalone-authoring path), unlike the pre-ADR-0068
    state the parametrized negative test above used to assert for `list`."""
    assert callable(_lookup("test-cases", "list"))
    assert callable(_lookup("test-cases", "create"))


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
