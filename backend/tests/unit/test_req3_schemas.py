"""Unit tests for REQ-3's two path-scoped create schemas (ADR-0028).

`CreateTestConditionForRequirementRequest` / `CreateTestCaseForTestConditionRequest`
back the bespoke routes in `app/api/routes/test_condition_authoring.py`.
Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_requirements_schemas.py`.

The load-bearing property under test, beyond ordinary required/optional
field validation, is that the parent FK (`requirement_id`/`test_condition_id`)
is NOT part of either body: it comes from the `{id}` path segment, and the
route stamps it. If someone re-added it as a required field these routes
would start 422-ing on a correct client request; if it were an *accepted*
field, a client could point the body at one parent while the path names
another. Both directions are asserted below.
"""

import pytest
from pydantic import ValidationError

from app.schemas.assets import (
    CreateTestCaseForTestConditionRequest,
    CreateTestConditionForRequirementRequest,
)

_UUID_A = "00000000-0000-0000-0000-00000000000a"
_UUID_B = "00000000-0000-0000-0000-00000000000b"
_UUID_C = "00000000-0000-0000-0000-00000000000c"


# --- CreateTestConditionForRequirementRequest --------------------------------------------------


def test_create_test_condition_accepts_valid_payload() -> None:
    request = CreateTestConditionForRequirementRequest(
        description="Password reset link expires after 15 minutes",
        priority="high",
    )
    assert request.description == "Password reset link expires after 15 minutes"
    assert request.priority == "high"


@pytest.mark.parametrize("priority", ["low", "medium", "high"])
def test_create_test_condition_accepts_every_catalogued_priority(priority: str) -> None:
    request = CreateTestConditionForRequirementRequest(description="A condition", priority=priority)
    assert request.priority == priority


def test_create_test_condition_requires_description() -> None:
    with pytest.raises(ValidationError):
        CreateTestConditionForRequirementRequest(priority="high")


def test_create_test_condition_requires_priority() -> None:
    with pytest.raises(ValidationError):
        CreateTestConditionForRequirementRequest(description="A condition")


def test_create_test_condition_rejects_invalid_priority() -> None:
    """`priority` is the `Literal` mirroring the model's `TestConditionPriority`
    enum — `"urgent"` is not in it, and must not silently pass through to a
    DB-level enum violation.
    """
    with pytest.raises(ValidationError):
        CreateTestConditionForRequirementRequest(description="A condition", priority="urgent")


def test_create_test_condition_does_not_require_requirement_id() -> None:
    """Path-scoped: `requirement_id` comes from `POST /requirements/{id}/...`.

    A body carrying only `description`/`priority` must validate — the route
    would be unusable otherwise.
    """
    request = CreateTestConditionForRequirementRequest(description="A condition", priority="low")
    assert "requirement_id" not in CreateTestConditionForRequirementRequest.model_fields
    assert request.model_dump() == {"description": "A condition", "priority": "low"}


def test_create_test_condition_ignores_a_requirement_id_in_the_body() -> None:
    """A client that sends `requirement_id` anyway can't override the path.

    Pydantic v2's default `extra="ignore"` drops it, so the dumped payload the
    route builds its row from never contains a caller-supplied parent FK.
    """
    request = CreateTestConditionForRequirementRequest.model_validate(
        {"description": "A condition", "priority": "medium", "requirement_id": _UUID_A}
    )
    assert request.model_dump() == {"description": "A condition", "priority": "medium"}


# --- CreateTestCaseForTestConditionRequest ------------------------------------------------------


def test_create_test_case_accepts_valid_payload() -> None:
    request = CreateTestCaseForTestConditionRequest(
        title="Reset link is rejected after 15 minutes",
        preconditions="A reset link was issued 16 minutes ago",
        expected_result="The user sees an 'expired link' error",
        test_level_id=_UUID_B,
        test_type_id=_UUID_C,
    )
    assert request.title == "Reset link is rejected after 15 minutes"
    assert str(request.test_level_id) == _UUID_B
    assert str(request.test_type_id) == _UUID_C


def test_create_test_case_preconditions_and_expected_result_are_optional() -> None:
    request = CreateTestCaseForTestConditionRequest(
        title="A minimal test case",
        test_level_id=_UUID_B,
        test_type_id=_UUID_C,
    )
    assert request.preconditions is None
    assert request.expected_result is None


def test_create_test_case_requires_title() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseForTestConditionRequest(test_level_id=_UUID_B, test_type_id=_UUID_C)


def test_create_test_case_requires_test_level_id() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseForTestConditionRequest(title="A test case", test_type_id=_UUID_C)


def test_create_test_case_requires_test_type_id() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseForTestConditionRequest(title="A test case", test_level_id=_UUID_B)


def test_create_test_case_rejects_a_malformed_uuid() -> None:
    with pytest.raises(ValidationError):
        CreateTestCaseForTestConditionRequest(
            title="A test case", test_level_id="not-a-uuid", test_type_id=_UUID_C
        )


def test_create_test_case_does_not_require_test_condition_id() -> None:
    """Path-scoped: `test_condition_id` comes from `POST /test-conditions/{id}/...`."""
    request = CreateTestCaseForTestConditionRequest(
        title="A test case", test_level_id=_UUID_B, test_type_id=_UUID_C
    )
    assert request.title == "A test case"
    assert "test_condition_id" not in CreateTestCaseForTestConditionRequest.model_fields


def test_create_test_case_ignores_test_condition_id_status_and_actor_in_the_body() -> None:
    """None of the three server-owned fields are accepted from the request.

    `test_condition_id` is the path's; `status` is always `draft`; and
    `created_by_actor_id` is stamped from the authenticated actor (ADR-0028) —
    so none may appear in the dump the route builds its row from.
    """
    request = CreateTestCaseForTestConditionRequest.model_validate(
        {
            "title": "A test case",
            "test_level_id": _UUID_B,
            "test_type_id": _UUID_C,
            "test_condition_id": _UUID_A,
            "status": "approved",
            "created_by_actor_id": _UUID_A,
        }
    )
    dumped = request.model_dump()
    assert set(dumped.keys()) == {
        "title",
        "preconditions",
        "expected_result",
        "test_level_id",
        "test_type_id",
    }
    for field_name in ("test_condition_id", "status", "created_by_actor_id"):
        assert field_name not in CreateTestCaseForTestConditionRequest.model_fields
