"""Unit tests for RBAC-3 request schemas — `CreateRoleAssignmentRequest`
(`app/schemas/rbac.py`, ADR-0021).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`test_rbac1_schemas.py`. `RoleAssignmentSummary` is a plain response shape
with no bespoke validation of its own, so it's not covered here (same
posture `test_rbac1_schemas.py` takes toward `OrgSummary`).
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.rbac import CreateRoleAssignmentRequest

_VALID_KWARGS = {"actor_id": uuid4(), "role_id": uuid4()}


# --- CreateRoleAssignmentRequest ----------------------------------------------------------


def test_create_role_assignment_request_accepts_valid_payload_org_wide() -> None:
    actor_id = uuid4()
    role_id = uuid4()
    request = CreateRoleAssignmentRequest(actor_id=actor_id, role_id=role_id)
    assert request.actor_id == actor_id
    assert request.role_id == role_id
    assert request.project_id is None


def test_create_role_assignment_request_accepts_valid_payload_project_scoped() -> None:
    actor_id = uuid4()
    role_id = uuid4()
    project_id = uuid4()
    request = CreateRoleAssignmentRequest(actor_id=actor_id, role_id=role_id, project_id=project_id)
    assert request.project_id == project_id


def test_create_role_assignment_request_project_id_omitted_defaults_to_none() -> None:
    request = CreateRoleAssignmentRequest(**_VALID_KWARGS)
    assert "project_id" not in request.model_fields_set
    assert request.project_id is None


def test_create_role_assignment_request_missing_actor_id_rejected() -> None:
    with pytest.raises(ValidationError):
        CreateRoleAssignmentRequest(role_id=uuid4())


def test_create_role_assignment_request_missing_role_id_rejected() -> None:
    with pytest.raises(ValidationError):
        CreateRoleAssignmentRequest(actor_id=uuid4())


def test_create_role_assignment_request_rejects_malformed_uuid() -> None:
    with pytest.raises(ValidationError):
        CreateRoleAssignmentRequest(actor_id="not-a-uuid", role_id=uuid4())
