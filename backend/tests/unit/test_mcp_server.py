"""Unit tests for MCP server construction."""

from __future__ import annotations

from app.mcp.server import mcp


def test_mcp_singleton_has_expected_name() -> None:
    assert mcp.name == "TestNexa-MCP"


def test_mcp_streamable_http_path_is_root() -> None:
    assert mcp.settings.streamable_http_path == "/"


def test_mcp_dns_rebinding_protection_is_disabled() -> None:
    assert mcp.settings.transport_security.enable_dns_rebinding_protection is False


def test_mcp_registers_exactly_the_two_test_case_tools() -> None:
    assert len(mcp._tool_manager._tools) == 2
    assert set(mcp._tool_manager._tools) == {"create_test_case", "list_test_cases"}
