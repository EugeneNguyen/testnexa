"""Unit tests for REQ-1's `title` gap-fill on `Requirement`'s generic-CRUD
schemas (`app/schemas/assets.py`, ADR-0024).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_projects_schemas.py`. Scope is narrow and mechanical: does
`CreateRequirementRequest` require `title`, does `UpdateRequirementRequest`
treat it as an optional partial-update field (`exclude_unset` semantics,
same posture every other optional `PATCH` field in this codebase already
uses), and does `RequirementSummary` carry it as a required `str`. The
route-level behavior (`?q=` search matching `title`, 422 on missing
`project_id`+`title`, etc.) belongs to the integration suite, not here.
"""

import pytest
from pydantic import ValidationError

from app.schemas.assets import (
    CreateRequirementRequest,
    RequirementSummary,
    UpdateRequirementRequest,
)

# --- CreateRequirementRequest ------------------------------------------------------------------


def test_create_requirement_request_requires_title() -> None:
    with pytest.raises(ValidationError):
        CreateRequirementRequest(
            project_id="00000000-0000-0000-0000-000000000001",
            description="Some description",
        )


def test_create_requirement_request_accepts_title_and_required_fields() -> None:
    request = CreateRequirementRequest(
        project_id="00000000-0000-0000-0000-000000000001",
        title="Login must support MFA",
        description="Some description",
    )
    assert request.title == "Login must support MFA"
    assert request.description == "Some description"
    assert request.external_ref is None
    assert request.source is None


# --- UpdateRequirementRequest ------------------------------------------------------------------


def test_update_requirement_request_title_is_optional() -> None:
    """Every field optional — a fully-omitted PATCH body is valid (a no-op update)."""
    request = UpdateRequirementRequest()
    assert request.model_fields_set == set()
    assert request.title is None


def test_update_requirement_request_accepts_partial_title_only() -> None:
    """`exclude_unset` partial-update semantics — only `title` present in the dump."""
    request = UpdateRequirementRequest.model_validate({"title": "Renamed requirement"})
    assert request.model_dump(exclude_unset=True) == {"title": "Renamed requirement"}


# --- RequirementSummary ------------------------------------------------------------------------


def test_requirement_summary_requires_title() -> None:
    with pytest.raises(ValidationError):
        RequirementSummary(
            id="00000000-0000-0000-0000-000000000002",
            project_id="00000000-0000-0000-0000-000000000001",
            description="Some description",
        )


def test_requirement_summary_carries_title() -> None:
    summary = RequirementSummary(
        id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000001",
        title="Login must support MFA",
        description="Some description",
    )
    assert summary.title == "Login must support MFA"
