"""Unit tests for PLAN-3's two bespoke-route request schemas (ADR-0033).

`CreateTestCycleRequest` (`app/schemas/planning.py`) backs
`POST /test-plans/{id}/test-cycles`; `CreateExecutionForCycleRequest`
(`app/schemas/execution.py`) backs `POST /test-cycles/{id}/executions`. Pure
Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_req3_schemas.py`, which pins the same property for REQ-3's own
pair of path-scoped create schemas.

The load-bearing property under test, beyond ordinary required/optional field
validation, is which fields are **absent**:

- `CreateTestCycleRequest` has no `test_plan_id` — it comes from the `{id}`
  path segment, and the route stamps it. Re-adding it as *required* would make
  these routes 422 on a correct client request; making it *accepted* would let
  a client point the body at one plan while the path names another, which is
  exactly the contradictable second source of truth the 404/403 gate is
  computed from.
- `CreateExecutionForCycleRequest` has neither `test_cycle_id` (same reason)
  nor `executed_by_actor_id` (stamped from the authenticated actor, never
  client-supplied — Test Design §29's "`executed_by_actor_id` stamping class").

Both directions are asserted for every such field: not required, and not
accepted.
"""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from app.schemas.execution import CreateExecutionForCycleRequest
from app.schemas.planning import CreateTestCycleRequest

_RELEASE_ID = "00000000-0000-0000-0000-0000000000a1"
_ENVIRONMENT_ID = "00000000-0000-0000-0000-0000000000a2"
_TEST_PLAN_ID = "00000000-0000-0000-0000-0000000000a3"
_TEST_CASE_ID = "00000000-0000-0000-0000-0000000000a4"
_TEST_CYCLE_ID = "00000000-0000-0000-0000-0000000000a5"
_ACTOR_ID = "00000000-0000-0000-0000-0000000000a6"


# --- CreateTestCycleRequest --------------------------------------------------------------------


def test_create_test_cycle_accepts_a_full_valid_payload() -> None:
    request = CreateTestCycleRequest(
        release_id=_RELEASE_ID,
        environment_id=_ENVIRONMENT_ID,
        name="Sprint 14 regression cycle",
        start_date="2026-09-07",
        end_date="2026-09-14",
    )
    assert str(request.release_id) == _RELEASE_ID
    assert str(request.environment_id) == _ENVIRONMENT_ID
    assert request.name == "Sprint 14 regression cycle"
    assert request.start_date == date(2026, 9, 7)
    assert request.end_date == date(2026, 9, 14)


def test_create_test_cycle_dates_are_optional() -> None:
    """PLAN-3 UI Design Document §1: both date inputs are optional, matching the
    columns' own nullability (`TestCycle.start_date`/`end_date` are `Date,
    nullable=True`).
    """
    request = CreateTestCycleRequest(
        release_id=_RELEASE_ID,
        environment_id=_ENVIRONMENT_ID,
        name="Undated cycle",
    )
    assert request.start_date is None
    assert request.end_date is None


@pytest.mark.parametrize("missing", ["release_id", "environment_id", "name"])
def test_create_test_cycle_requires_release_environment_and_name(missing: str) -> None:
    payload = {
        "release_id": _RELEASE_ID,
        "environment_id": _ENVIRONMENT_ID,
        "name": "A cycle",
    }
    payload.pop(missing)
    with pytest.raises(ValidationError):
        CreateTestCycleRequest(**payload)


def test_create_test_cycle_rejects_a_malformed_uuid() -> None:
    with pytest.raises(ValidationError):
        CreateTestCycleRequest(
            release_id="not-a-uuid",
            environment_id=_ENVIRONMENT_ID,
            name="A cycle",
        )


def test_create_test_cycle_does_not_require_test_plan_id() -> None:
    """`test_plan_id` comes from the path, so a body omitting it is VALID.

    Direction 1 of the pair: if someone re-added it as a required field, this
    construction (which mirrors exactly what the frontend sends) would raise.
    """
    request = CreateTestCycleRequest(
        release_id=_RELEASE_ID,
        environment_id=_ENVIRONMENT_ID,
        name="A cycle",
    )
    assert not hasattr(request, "test_plan_id")


def test_create_test_cycle_ignores_a_client_supplied_test_plan_id() -> None:
    """Direction 2: a client that *does* send `test_plan_id` cannot make it
    stick — the field does not exist on the model, so Pydantic drops it rather
    than letting the body contradict the path segment.
    """
    request = CreateTestCycleRequest(
        release_id=_RELEASE_ID,
        environment_id=_ENVIRONMENT_ID,
        name="A cycle",
        test_plan_id=_TEST_PLAN_ID,
    )
    assert "test_plan_id" not in request.model_dump()


def test_create_test_cycle_does_not_validate_date_ordering() -> None:
    """PLAN-3 UI Design Document §4 (explicit non-goal): no cross-field
    `end_date >= start_date` rule — no acceptance criterion asks for one, and
    this codebase does not invent validation beyond what a story states.
    Asserted as a positive case so that adding such a rule later is a
    deliberate, visible change rather than a silent one.
    """
    request = CreateTestCycleRequest(
        release_id=_RELEASE_ID,
        environment_id=_ENVIRONMENT_ID,
        name="Backwards cycle",
        start_date="2026-09-14",
        end_date="2026-09-07",
    )
    assert request.start_date > request.end_date


# --- CreateExecutionForCycleRequest --------------------------------------------------------------


def test_create_execution_accepts_a_full_valid_payload() -> None:
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result="pass",
        actual_result="Behaved as expected.",
        executed_at="2026-09-06T10:30:00Z",
    )
    assert str(request.test_case_id) == _TEST_CASE_ID
    assert request.result == "pass"
    assert request.actual_result == "Behaved as expected."
    assert isinstance(request.executed_at, datetime)


@pytest.mark.parametrize("result", ["pass", "fail", "blocked", "skipped"])
def test_create_execution_accepts_every_catalogued_result(result: str) -> None:
    """The `Literal` mirrors `app/models/execution.py`'s `TestExecutionResult`
    enum *values* — note the DB value is `"pass"` even though the Python member
    is named `passed` (`pass` is a keyword), so the wire contract is the value.
    """
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result=result,
        executed_at="2026-09-06T10:30:00Z",
    )
    assert request.result == result


def test_create_execution_rejects_an_uncatalogued_result() -> None:
    with pytest.raises(ValidationError):
        CreateExecutionForCycleRequest(
            test_case_id=_TEST_CASE_ID,
            result="passed",  # the Python member name, not the wire value
            executed_at="2026-09-06T10:30:00Z",
        )


def test_create_execution_actual_result_is_optional() -> None:
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result="blocked",
        executed_at="2026-09-06T10:30:00Z",
    )
    assert request.actual_result is None


@pytest.mark.parametrize("missing", ["test_case_id", "result", "executed_at"])
def test_create_execution_requires_case_result_and_timestamp(missing: str) -> None:
    payload = {
        "test_case_id": _TEST_CASE_ID,
        "result": "fail",
        "executed_at": "2026-09-06T10:30:00Z",
    }
    payload.pop(missing)
    with pytest.raises(ValidationError):
        CreateExecutionForCycleRequest(**payload)


def test_create_execution_does_not_require_test_cycle_id() -> None:
    """`test_cycle_id` comes from the path — a body omitting it is VALID."""
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result="pass",
        executed_at="2026-09-06T10:30:00Z",
    )
    assert not hasattr(request, "test_cycle_id")


def test_create_execution_ignores_a_client_supplied_test_cycle_id() -> None:
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result="pass",
        executed_at="2026-09-06T10:30:00Z",
        test_cycle_id=_TEST_CYCLE_ID,
    )
    assert "test_cycle_id" not in request.model_dump()


def test_create_execution_ignores_a_client_supplied_executed_by_actor_id() -> None:
    """Test Design §29's "`executed_by_actor_id` stamping class", at the schema
    layer: the field does not exist on the request model at all, so there is
    nothing for a malicious or mistaken caller-supplied value to override — the
    route always stamps the authenticated actor. The integration suite asserts
    the same property end to end against a live server; this is the cheap,
    fast half of the same guarantee.
    """
    request = CreateExecutionForCycleRequest(
        test_case_id=_TEST_CASE_ID,
        result="pass",
        executed_at="2026-09-06T10:30:00Z",
        executed_by_actor_id=_ACTOR_ID,
    )
    assert not hasattr(request, "executed_by_actor_id")
    assert "executed_by_actor_id" not in request.model_dump()
