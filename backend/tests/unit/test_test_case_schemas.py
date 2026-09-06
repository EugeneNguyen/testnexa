"""Unit tests for REQ-2's `CreateTestCaseRequest` schema (`app/schemas/assets.py`).

Pure Pydantic-model construction, no DB/network — mirrors
`test_requirements_schemas.py`'s style. Route-level behavior (atomic
TestCase + RequirementTestCaseLink creation, permission gating, org
resolution) belongs to the integration suite, not here.
"""

import pytest
from pydantic import ValidationError

from app.schemas.assets import CreateTestCaseRequest


def test_create_test_case_request_requires_title() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseRequest(
            test_level_id="00000000-0000-0000-0000-000000000001",
            test_type_id="00000000-0000-0000-0000-000000000002",
        )


def test_create_test_case_request_requires_test_level_id() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseRequest(
            title="Login rejects bad password",
            test_type_id="00000000-0000-0000-0000-000000000002",
        )


def test_create_test_case_request_requires_test_type_id() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseRequest(
            title="Login rejects bad password",
            test_level_id="00000000-0000-0000-0000-000000000001",
        )


def test_create_test_case_request_accepts_minimal_required_fields() -> None:
    request = CreateTestCaseRequest(
        title="Login rejects bad password",
        test_level_id="00000000-0000-0000-0000-000000000001",
        test_type_id="00000000-0000-0000-0000-000000000002",
    )
    assert request.title == "Login rejects bad password"
    assert request.preconditions is None
    assert request.expected_result is None
    assert request.status == "draft"


def test_create_test_case_request_accepts_all_fields() -> None:
    request = CreateTestCaseRequest(
        title="Login rejects bad password",
        preconditions="User account exists",
        expected_result="401 returned",
        status="reviewed",
        test_level_id="00000000-0000-0000-0000-000000000001",
        test_type_id="00000000-0000-0000-0000-000000000002",
    )
    assert request.preconditions == "User account exists"
    assert request.expected_result == "401 returned"
    assert request.status == "reviewed"
