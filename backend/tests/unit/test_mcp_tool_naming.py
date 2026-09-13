"""MCP-6/ADR-0067 tool-surface completeness — the diff-based test
`backend/CLAUDE.md`'s "hand-authored registry spanning many entities needs a
diff-based completeness test, not spot-checks" note requires.

TC-MCP-024 (naming scheme + per-entity/per-action completeness),
TC-MCP-025 (nothing orphaned, no leftover pre-ADR-0067 tool name).

The whole risk this file exists to close: with ~146 generated tools, an
entity or a method silently missing its tool is invisible — that capability
just quietly stops being reachable over MCP, with no error anywhere, exactly
the "degrades silently" failure shape ADR-0055's own `FieldMeta` note and
MCP-5's registry-completeness test already describe one level down. Spot
checks cannot catch it; only a **diff** against the source of truth can.

Every assertion below is therefore a set difference against
`ALL_ENTITY_CONFIGS`/`CrudEntityConfig.full_methods` — never a hardcoded
list of expected names, which would drift with the thing it is meant to
police. The one hand-written constant here (`_EXPECTED_CONFIGLESS`) names
the three resources that deliberately have no `CrudEntityConfig` at all, so
that adding a fourth is a deliberate test edit rather than a silent pass.

`full_methods` (ADR-0053), **not** `methods`, per that same `CLAUDE.md`
note: `project`'s `get`/`update` are real, bespoke, correctly-registered
routes at the same URL the generic factory doesn't cover, and
`_PROJECT_FACTORY_CONFIG.methods` is only `{"list","delete"}` by design — a
diff against `methods` false-positives on exactly that one entity.
"""

from __future__ import annotations

import pytest

from app.api.entity_registry import ALL_ENTITY_CONFIGS
from app.mcp.server import mcp
from app.mcp.tool_registry import (
    ACTIONS,
    BESPOKE_EXTRA_ACTIONS,
    ENTITY_CONFIGS_BY_RESOURCE,
    TOOL_NAME_PREFIX,
    TOOL_REGISTRY,
    tool_name,
)
from app.mcp.tools.entity_tools import (
    BESPOKE_CREATE_PARENT_FIELDS,
    BESPOKE_LIST_SCOPE_FIELDS,
    generated_tool_names,
)

#: The three resources with no `CrudEntityConfig` at all — 100% bespoke REST
#: surfaces (`Release`'s own ADR-0027 note; the two join-table "add" routes).
#: They therefore get no `describe` tool, and their whole registry row is a
#: `BESPOKE_EXTRA_ACTIONS` entry.
_EXPECTED_CONFIGLESS = {"release", "test_suite_test_case", "test_plan_test_suite"}


def _registered() -> dict[str, object]:
    return mcp._tool_manager._tools


def _rest_surface(resource: str) -> frozenset[str]:
    """This entity's true REST-reachable method set — `full_methods` where the
    config declares one, else `methods`, matching `derive_entity_schema`."""
    config = ENTITY_CONFIGS_BY_RESOURCE[resource]
    return config.full_methods if config.full_methods is not None else config.methods


# --- TC-MCP-024: registry ↔ REST surface parity ------------------------------------------


def test_every_entity_config_has_a_registry_row() -> None:
    """No entity in the generic factory's own collected index may be missing
    from the MCP registry — the 30-entity-scale version of the resolver/gate
    completeness gaps `backend/CLAUDE.md` documents one entity at a time."""
    expected = {config.resource for config in ALL_ENTITY_CONFIGS.values()}
    assert expected - set(TOOL_REGISTRY) == set()


def test_configless_resources_are_exactly_the_three_bespoke_ones() -> None:
    configless = set(TOOL_REGISTRY) - set(ENTITY_CONFIGS_BY_RESOURCE)
    assert configless == _EXPECTED_CONFIGLESS


def test_registry_actions_equal_rest_surface_plus_declared_bespoke_extras() -> None:
    """The core diff. For every entity with a config, the registry's action set
    must equal `full_methods` ∪ its declared `BESPOKE_EXTRA_ACTIONS` ∪
    `{"describe"}` — **exactly**, in both directions.

    Missing action → that capability is silently unreachable over MCP.
    Surplus action → MCP grants something REST doesn't (MCP-5's own AC,
    carried forward by ADR-0067 Decision §2), or a bespoke executor was added
    without declaring it, which is the same silent-widening risk.
    """
    for resource in sorted(ENTITY_CONFIGS_BY_RESOURCE):
        expected = set(_rest_surface(resource)) | set(BESPOKE_EXTRA_ACTIONS.get(resource, frozenset())) | {"describe"}
        assert set(TOOL_REGISTRY[resource]) == expected, f"{resource}: registry/REST-surface mismatch"


def test_configless_resources_registry_equals_their_declared_extras() -> None:
    """The three config-less resources have no `full_methods` to diff against,
    so their entire row must be exactly what `BESPOKE_EXTRA_ACTIONS` declares —
    and no `describe`, since there is no config for `derive_entity_schema` to
    describe (the same `404` `GET /entities/releases/schema` itself gives)."""
    for resource in sorted(_EXPECTED_CONFIGLESS):
        assert set(TOOL_REGISTRY[resource]) == set(BESPOKE_EXTRA_ACTIONS[resource]), resource
        assert "describe" not in TOOL_REGISTRY[resource], resource


def test_bespoke_extra_actions_declares_no_resource_the_registry_lacks() -> None:
    """The reverse direction of the diff above: a `BESPOKE_EXTRA_ACTIONS` row
    for an entity/action with no executor behind it would make the parity test
    pass vacuously while advertising nothing."""
    for resource, actions in BESPOKE_EXTRA_ACTIONS.items():
        assert resource in TOOL_REGISTRY, f"{resource} declared as bespoke but absent from the registry"
        assert set(actions) <= set(TOOL_REGISTRY[resource]), f"{resource}: declared extras not all registered"


def test_every_registry_action_is_a_known_action_verb() -> None:
    for resource, entry in TOOL_REGISTRY.items():
        unknown = set(entry) - set(ACTIONS)
        assert unknown == set(), f"{resource} registers unknown action(s) {unknown}"


def test_describe_is_registered_for_exactly_the_entities_with_a_config() -> None:
    with_describe = {resource for resource, entry in TOOL_REGISTRY.items() if "describe" in entry}
    assert with_describe == set(ENTITY_CONFIGS_BY_RESOURCE)


# --- TC-MCP-024: naming scheme --------------------------------------------------------------


def test_generated_names_match_the_registry_one_for_one() -> None:
    """One tool per (entity, action) row — no row without a tool, no tool
    without a row."""
    expected = {tool_name(resource, action) for resource, entry in TOOL_REGISTRY.items() for action in entry}
    assert set(generated_tool_names()) == expected
    assert len(generated_tool_names()) == len(expected), "duplicate name generated"


def test_registered_tools_are_exactly_the_generated_names() -> None:
    """The FastMCP instance itself — not just the generator's own idea of what
    it would produce — carries exactly this set. Catches a registration path
    that silently drops or double-registers a name."""
    assert set(_registered()) == set(generated_tool_names())


def test_every_registered_tool_name_parses_back_to_its_entity_and_action() -> None:
    """`tn_<resource>_<action>` must be unambiguously decodable. The parse is
    right-to-left on the action (resource slugs contain underscores;
    `tn_test_case_defect_link_get` is `test_case_defect_link` + `get`, not
    `test` + everything else)."""
    for name in _registered():
        assert name.startswith(TOOL_NAME_PREFIX), name
        body = name[len(TOOL_NAME_PREFIX) :]
        resource, _, action = body.rpartition("_")
        assert resource in TOOL_REGISTRY, f"{name} decodes to unknown resource {resource!r}"
        assert action in TOOL_REGISTRY[resource], f"{name} decodes to unregistered action {action!r}"


def test_tool_names_use_the_verbatim_resource_slug_never_an_abbreviation() -> None:
    """ADR-0067 Decision §3: the entity segment is each route module's own
    literal `resource="..."` string, not a shortened or pluralized variant."""
    for config in ALL_ENTITY_CONFIGS.values():
        assert tool_name(config.resource, "describe") in _registered(), config.resource
    # Spot-anchor the exact spellings the ADR names, so a future "tidy-up"
    # rename shows up here rather than silently breaking every client config.
    for expected in ("tn_organization_get", "tn_project_create", "tn_requirement_list", "tn_test_case_update"):
        assert expected in _registered(), expected


def test_no_tool_name_exceeds_a_conservative_client_length_limit() -> None:
    """Several MCP clients cap tool names (64 chars is the common ceiling).
    The longest slug here is `requirement_test_condition_link`; assert with
    headroom so a future long-named entity fails here, not in a client."""
    longest = max(_registered(), key=len)
    assert len(longest) <= 64, longest


# --- TC-MCP-025: nothing orphaned -----------------------------------------------------------


@pytest.mark.parametrize(
    "retired",
    [
        # ADR-0065's 6 reflective tools (superseded by ADR-0067)
        "list_entities",
        "get_entity",
        "create_entity",
        "update_entity",
        "delete_entity",
        "describe_entity",
        # ADR-0033/MCP-1's 2 hand-wired tools (folded into tn_test_case_*)
        "create_test_case",
        "list_test_cases",
    ],
)
def test_pre_adr_0067_tool_names_are_gone(retired: str) -> None:
    """Not merely "a replacement exists" — the old name must be *unregistered*.
    Leaving one live would publish two differently-named tools for the same
    capability, which is precisely the duplicate surface ADR-0067 removes."""
    assert retired not in _registered()


def test_every_registered_tool_carries_a_nonempty_description() -> None:
    """`tools/list` descriptions are the only signal a model has for choosing
    among ~146 tools — an empty one is a silent usability hole."""
    for name, tool in _registered().items():
        assert tool.description, f"{name} has no description"
        assert len(tool.description) > 40, f"{name}'s description is too thin to disambiguate: {tool.description!r}"


def test_no_tool_takes_a_resource_argument() -> None:
    """ADR-0067 Decision §1 — the entity is the tool's identity, never one of
    its arguments. A leftover `resource` param would mean a tool still
    dispatching reflectively."""
    for name, tool in _registered().items():
        assert "resource" not in tool.parameters.get("properties", {}), name


def test_each_action_publishes_exactly_its_own_arguments() -> None:
    """Per-action input-schema shape (ADR-0067 Decision §1's "each tool's input
    schema carries only the arguments that action genuinely takes")."""
    expected_props = {
        "list": {"scope", "filters", "search", "sort", "page", "page_size"},
        "get": {"id"},
        "create": {"fields"},
        "update": {"id", "fields"},
        "delete": {"id"},
        "describe": set(),
    }
    for name, tool in _registered().items():
        action = name.rpartition("_")[2]
        props = set(tool.parameters.get("properties", {}))
        assert props == expected_props[action], f"{name}: unexpected argument set {props}"


def test_required_arguments_match_the_action() -> None:
    """`id`/`fields` are genuinely required (no silent default that would let a
    model omit them and get a confusing downstream error); every `list`
    argument is optional."""
    expected_required = {
        "list": set(),
        "get": {"id"},
        "create": {"fields"},
        "update": {"id", "fields"},
        "delete": {"id"},
        "describe": set(),
    }
    for name, tool in _registered().items():
        action = name.rpartition("_")[2]
        assert set(tool.parameters.get("required", [])) == expected_required[action], name


# --- description-metadata completeness ------------------------------------------------------


def test_bespoke_create_parent_fields_covers_exactly_the_bespoke_creates() -> None:
    """The hand-declared parent-id hints must name every entity whose `create`
    is bespoke, and no other — a missing entry silently ships a `create` tool
    whose description never mentions the parent id the call cannot succeed
    without."""
    bespoke_creates = {resource for resource, actions in BESPOKE_EXTRA_ACTIONS.items() if "create" in actions}
    # `project`'s create is bespoke too, but already declared in its own
    # `full_methods`, so it contributes no BESPOKE_EXTRA_ACTIONS row.
    bespoke_creates.add("project")
    assert set(BESPOKE_CREATE_PARENT_FIELDS) == bespoke_creates


def test_bespoke_list_scope_fields_covers_exactly_the_bespoke_lists() -> None:
    bespoke_lists = {resource for resource, actions in BESPOKE_EXTRA_ACTIONS.items() if "list" in actions}
    assert set(BESPOKE_LIST_SCOPE_FIELDS) == bespoke_lists
