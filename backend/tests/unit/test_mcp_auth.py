"""Unit tests for MCP auth helpers."""

from __future__ import annotations

import json

import pytest
from mcp.server.fastmcp.exceptions import ToolError

from app.mcp.auth import _ensure_agent_key_shape, _extract_bearer_token


def test_extract_bearer_token_none_raises_invalid_token() -> None:
    with pytest.raises(ToolError) as excinfo:
        _extract_bearer_token(None)

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


def test_extract_bearer_token_empty_header_raises_invalid_token() -> None:
    with pytest.raises(ToolError) as excinfo:
        _extract_bearer_token("")

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


def test_extract_bearer_token_garbage_header_raises_invalid_token() -> None:
    with pytest.raises(ToolError) as excinfo:
        _extract_bearer_token("garbage")

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


def test_extract_bearer_token_missing_token_segment_raises_invalid_token() -> None:
    with pytest.raises(ToolError) as excinfo:
        _extract_bearer_token("Bearer")

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


def test_extract_bearer_token_lowercase_scheme_is_accepted() -> None:
    assert _extract_bearer_token("bearer tnx_agent_abc_def") == "tnx_agent_abc_def"


def test_extract_bearer_token_preserves_inner_whitespace() -> None:
    assert _extract_bearer_token("Bearer   spaced   token") == "spaced   token"


def test_ensure_agent_key_shape_rejects_non_agent_prefix() -> None:
    with pytest.raises(ToolError) as excinfo:
        _ensure_agent_key_shape("not_tnx_agent_xxx")

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }


def test_ensure_agent_key_shape_accepts_empty_suffix_agent_key() -> None:
    _ensure_agent_key_shape("tnx_agent_")


def test_ensure_agent_key_shape_rejects_empty_string() -> None:
    with pytest.raises(ToolError) as excinfo:
        _ensure_agent_key_shape("")

    assert json.loads(excinfo.value.args[0]) == {
        "code": "invalid_token",
        "message": "Invalid or expired access token.",
        "field_errors": None,
    }
