"""Unit tests for MCP tool error mapping.

`_raise_as_tool_error` moved from `app/mcp/tools/test_cases.py` (ADR-0033/
MCP-1, retired by ADR-0068) to `app/mcp/tools/entity_tools.py` — the
function body and the envelope contract it guarantees (ADR-0033 decision 4)
are unchanged, so these two tests carry over verbatim against the new
import path.
"""

from __future__ import annotations

import json

import pytest
from fastapi.responses import JSONResponse
from mcp.server.fastmcp.exceptions import ToolError

from app.mcp.tools.entity_tools import _raise_as_tool_error


def test_raise_as_tool_error_preserves_permission_denied_envelope() -> None:
    response = JSONResponse(
        status_code=403,
        content={
            "code": "permission_denied",
            "message": "You do not have permission to perform this action.",
            "field_errors": None,
        },
    )

    with pytest.raises(ToolError) as excinfo:
        _raise_as_tool_error(response)

    assert json.loads(excinfo.value.args[0]) == {
        "code": "permission_denied",
        "message": "You do not have permission to perform this action.",
        "field_errors": None,
    }


def test_raise_as_tool_error_preserves_validation_error_field_errors() -> None:
    response = JSONResponse(
        status_code=422,
        content={
            "code": "validation_error",
            "message": "Request failed validation.",
            "field_errors": {"title": ["String should have at least 1 character"]},
        },
    )

    with pytest.raises(ToolError) as excinfo:
        _raise_as_tool_error(response)

    assert json.loads(excinfo.value.args[0]) == {
        "code": "validation_error",
        "message": "Request failed validation.",
        "field_errors": {"title": ["String should have at least 1 character"]},
    }
