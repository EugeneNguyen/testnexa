"""Unit tests for MCP server construction."""

from __future__ import annotations

from app.mcp.server import mcp


def test_mcp_singleton_has_expected_name() -> None:
    assert mcp.name == "TestNexa-MCP"


def test_mcp_streamable_http_path_is_root() -> None:
    assert mcp.settings.streamable_http_path == "/"


def test_mcp_dns_rebinding_protection_is_disabled() -> None:
    assert mcp.settings.transport_security.enable_dns_rebinding_protection is False


def test_mcp_registers_the_mcp1_test_case_tools_and_the_mcp5_generic_tools() -> None:
    """MCP-1's own 2 hand-wired tools stay registered unchanged; MCP-5
    (ADR-0065) adds 6 reflective tools alongside them, not in place of
    them — corrected in place from this test's own original "exactly 2"
    claim, which described MCP-1's surface accurately at the time but not
    the total tool count once MCP-5 landed (`docs/CLAUDE.md`'s "claim still
    true, just not the whole picture" correction posture)."""
    assert set(mcp._tool_manager._tools) == {
        "create_test_case",
        "list_test_cases",
        "list_entities",
        "get_entity",
        "create_entity",
        "update_entity",
        "delete_entity",
        "describe_entity",
    }
