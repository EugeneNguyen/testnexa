"""Unit tests for PROJ-1 request schemas — `CreateProjectRequest`/
`UpdateProjectRequest` (`app/schemas/projects.py`, ADR-0017).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_rbac1_schemas.py`.

The route-level `standards_profile` omitted-vs-explicit-null distinction
(ADR-0017 Q3 — omitted inherits `Organization.default_standards_profile`,
explicit `null` clears/overrides) is implemented via `exclude_unset`/
`model_fields_set`, not a schema-level trick — so what's tested here at the
schema layer is narrower and more mechanical than the route's actual
inherit-vs-override *behavior* (that behavior belongs to
`tests/integration/test_projects.py`, not this file): does
`model_fields_set` actually differ between a dict that omits the key and one
that supplies it as `None`, for both `CreateProjectRequest` and
`UpdateProjectRequest`.
"""

import pytest
from pydantic import ValidationError

from app.schemas.projects import CreateProjectRequest, UpdateProjectRequest

# --- CreateProjectRequest ------------------------------------------------------------------


def test_create_project_request_requires_name() -> None:
    with pytest.raises(ValidationError):
        CreateProjectRequest(standards_profile="iso-29119")


def test_create_project_request_accepts_name_only() -> None:
    request = CreateProjectRequest(name="Checkout Revamp")
    assert request.name == "Checkout Revamp"
    assert request.standards_profile is None


def test_create_project_request_accepts_explicit_standards_profile() -> None:
    request = CreateProjectRequest(name="Checkout Revamp", standards_profile="iso-29119")
    assert request.standards_profile == "iso-29119"


def test_create_project_request_distinguishes_omitted_vs_explicit_null_standards_profile() -> None:
    """`exclude_unset`'s seam: omitted vs. explicit `null` must diverge in `model_fields_set`."""
    omitted = CreateProjectRequest.model_validate({"name": "Checkout Revamp"})
    explicit_null = CreateProjectRequest.model_validate({"name": "Checkout Revamp", "standards_profile": None})

    assert "standards_profile" not in omitted.model_fields_set
    assert "standards_profile" in explicit_null.model_fields_set
    # Both resolve to the same `None` attribute value — the distinction only
    # lives in `model_fields_set`, never in the attribute itself.
    assert omitted.standards_profile is None
    assert explicit_null.standards_profile is None


# --- UpdateProjectRequest ------------------------------------------------------------------


def test_update_project_request_allows_empty_body() -> None:
    """Every field optional — a fully-omitted PATCH body is valid (a no-op update)."""
    request = UpdateProjectRequest()
    assert request.model_fields_set == set()


def test_update_project_request_accepts_partial_name_only() -> None:
    request = UpdateProjectRequest.model_validate({"name": "Renamed Project"})
    assert request.model_dump(exclude_unset=True) == {"name": "Renamed Project"}


def test_update_project_request_distinguishes_omitted_vs_explicit_null_standards_profile() -> None:
    omitted = UpdateProjectRequest.model_validate({"name": "Renamed Project"})
    explicit_null = UpdateProjectRequest.model_validate({"name": "Renamed Project", "standards_profile": None})

    assert "standards_profile" not in omitted.model_fields_set
    assert "standards_profile" in explicit_null.model_fields_set
    assert omitted.model_dump(exclude_unset=True) == {"name": "Renamed Project"}
    assert explicit_null.model_dump(exclude_unset=True) == {
        "name": "Renamed Project",
        "standards_profile": None,
    }


def test_update_project_request_accepts_standards_profile_only() -> None:
    request = UpdateProjectRequest.model_validate({"standards_profile": "iso-29119"})
    assert request.model_dump(exclude_unset=True) == {"standards_profile": "iso-29119"}
