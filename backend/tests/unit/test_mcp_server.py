"""Unit tests for MCP server construction."""

from __future__ import annotations

from app.mcp.server import mcp
from app.mcp.tools.entity_tools import generated_tool_names


def test_mcp_singleton_has_expected_name() -> None:
    assert mcp.name == "TestNexa-MCP"


def test_mcp_streamable_http_path_is_root() -> None:
    assert mcp.settings.streamable_http_path == "/"


def test_mcp_dns_rebinding_protection_is_disabled() -> None:
    assert mcp.settings.transport_security.enable_dns_rebinding_protection is False


def test_mcp_registers_exactly_the_generated_per_entity_tool_surface() -> None:
    """ADR-0067 replaces both prior tool sets — MCP-1's 2 hand-wired
    `create_test_case`/`list_test_cases` and MCP-5's 6 reflective
    `*_entity`/`*_entities` — with one generated tool per entity per
    supported action. Corrected in place a second time, same posture as the
    last correction (`docs/CLAUDE.md`'s "claim still true, just not the whole
    picture"); this time the old names are genuinely gone, not merely joined.

    Asserted against `generated_tool_names()` rather than a literal list: a
    literal would have to be re-typed on every entity/method change, which is
    exactly the hand-kept second list ADR-0067 exists to avoid. The *content*
    of that generated set is proved independently — against
    `ALL_ENTITY_CONFIGS`/`full_methods`, not against the generator — in
    `tests/unit/test_mcp_tool_naming.py`.
    """
    assert set(mcp._tool_manager._tools) == set(generated_tool_names())


def test_mcp_tool_surface_is_the_expected_order_of_magnitude() -> None:
    """A sanity floor/ceiling on the generated count, so a catastrophic
    registration regression (one entity registered, or every action for every
    entity regardless of support) fails loudly here even if the diff test's
    own source of truth were to break in the same way. 27 configured entities
    + 3 config-less bespoke resources; ~4-6 actions each."""
    assert 100 <= len(mcp._tool_manager._tools) <= 200
