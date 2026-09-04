"""Unit tests for PROJ-2 request/response schemas —
`CreateReleaseRequest`/`ReleaseSummary`/`ReleaseListResponse`/
`TestExecutionSummary`/`TestCycleSummary` (`app/schemas/releases.py`,
ADR-0019).

Pure Pydantic-model construction, no DB/network — mirrors the style of
`tests/unit/test_projects_schemas.py`.
"""

from datetime import date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.releases import (
    CreateReleaseRequest,
    ReleaseListResponse,
    ReleaseSummary,
    TestCycleSummary,
    TestExecutionSummary,
)

# --- CreateReleaseRequest ------------------------------------------------------------------


def test_create_release_request_requires_version_label() -> None:
    with pytest.raises(ValidationError):
        CreateReleaseRequest(target_date=date(2026, 12, 1))


def test_create_release_request_accepts_version_label_only() -> None:
    request = CreateReleaseRequest(version_label="2.3.0")
    assert request.version_label == "2.3.0"
    assert request.target_date is None


def test_create_release_request_accepts_explicit_target_date() -> None:
    request = CreateReleaseRequest(version_label="2.3.0", target_date=date(2026, 12, 1))
    assert request.target_date == date(2026, 12, 1)


def test_create_release_request_accepts_explicit_null_target_date() -> None:
    request = CreateReleaseRequest.model_validate({"version_label": "2.3.0", "target_date": None})
    assert request.target_date is None


# --- ReleaseSummary --------------------------------------------------------------------------


def test_release_summary_round_trips_all_fields() -> None:
    release_id = uuid4()
    project_id = uuid4()
    summary = ReleaseSummary(
        id=release_id,
        project_id=project_id,
        version_label="2.3.0",
        target_date=date(2026, 12, 1),
    )
    assert summary.id == release_id
    assert summary.project_id == project_id
    assert summary.version_label == "2.3.0"
    assert summary.target_date == date(2026, 12, 1)


def test_release_summary_allows_null_target_date() -> None:
    summary = ReleaseSummary(id=uuid4(), project_id=uuid4(), version_label="2.3.0", target_date=None)
    assert summary.target_date is None


# --- ReleaseListResponse ----------------------------------------------------------------------


def test_release_list_response_shape() -> None:
    item = ReleaseSummary(id=uuid4(), project_id=uuid4(), version_label="2.3.0", target_date=None)
    response = ReleaseListResponse(items=[item], total=1, page=1, page_size=25)
    assert response.items == [item]
    assert response.total == 1
    assert response.page == 1
    assert response.page_size == 25


def test_release_list_response_accepts_empty_items() -> None:
    response = ReleaseListResponse(items=[], total=0, page=1, page_size=25)
    assert response.items == []
    assert response.total == 0


# --- TestExecutionSummary --------------------------------------------------------------------


def test_test_execution_summary_round_trips_all_fields() -> None:
    execution_id = uuid4()
    test_case_id = uuid4()
    executed_at = datetime(2026, 9, 1, 12, 0, 0)
    summary = TestExecutionSummary(
        id=execution_id, test_case_id=test_case_id, result="pass", executed_at=executed_at
    )
    assert summary.id == execution_id
    assert summary.test_case_id == test_case_id
    assert summary.result == "pass"
    assert summary.executed_at == executed_at


def test_test_execution_summary_requires_all_fields() -> None:
    with pytest.raises(ValidationError):
        TestExecutionSummary(id=uuid4(), test_case_id=uuid4(), result="pass")


# --- TestCycleSummary -------------------------------------------------------------------------


def test_test_cycle_summary_nests_executions() -> None:
    execution = TestExecutionSummary(
        id=uuid4(), test_case_id=uuid4(), result="fail", executed_at=datetime(2026, 9, 1)
    )
    cycle = TestCycleSummary(
        id=uuid4(),
        release_id=uuid4(),
        test_plan_id=uuid4(),
        environment_id=uuid4(),
        name="Regression Cycle 1",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 15),
        executions=[execution],
    )
    assert cycle.executions == [execution]
    assert cycle.name == "Regression Cycle 1"


def test_test_cycle_summary_allows_empty_executions_and_null_dates() -> None:
    cycle = TestCycleSummary(
        id=uuid4(),
        release_id=uuid4(),
        test_plan_id=uuid4(),
        environment_id=uuid4(),
        name="Empty Cycle",
        start_date=None,
        end_date=None,
        executions=[],
    )
    assert cycle.executions == []
    assert cycle.start_date is None
    assert cycle.end_date is None
