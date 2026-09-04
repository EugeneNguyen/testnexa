"""Model-registry smoke tests: importing app.models must not raise, and the
resulting metadata must contain every table described in the Database
Document's detailed per-cluster listing.

See app/models/__init__.py for the documented deviation: the Database
Document's own summary claims "36" physical tables (35 at scaffold time,
+1 `login_attempt` added by AUTH-1/ADR-0011), but its detailed column-level
per-cluster listing literally names 39 distinct tables. This test asserts
against the actual, verified count (39, +1 `invite` added by RBAC-2/
ADR-0017 = 40) rather than the document's inconsistent summary number.
"""

import app.models
from app.db.base import Base


def test_import_does_not_raise() -> None:
    # Import already happened at module load above; re-import is a no-op cache hit.
    import importlib

    importlib.reload(app.models)


def test_metadata_has_expected_table_count() -> None:
    assert len(Base.metadata.tables) == 40


def test_expected_table_names_present() -> None:
    table_names = set(Base.metadata.tables.keys())
    expected = {
        "organization",
        "org_membership",
        "auth_identity",
        "refresh_token",
        "role",
        "permission",
        "role_permission",
        "role_assignment",
        "actor",
        "user",
        "ai_agent",
        "project",
        "release",
        "requirement",
        "test_condition",
        "test_case",
        "test_step",
        "test_suite",
        "test_suite_test_case",
        "test_plan",
        "test_plan_test_suite",
        "entry_exit_criteria",
        "environment",
        "test_cycle",
        "test_execution",
        "test_log",
        "defect",
        "requirement_test_case_link",
        "requirement_test_condition_link",
        "test_condition_test_case_link",
        "test_case_defect_link",
        "test_design_technique",
        "test_level",
        "test_type",
        "test_case_test_design_technique",
        "approval",
        "risk_item",
        "attachment",
        "login_attempt",
        "invite",
    }
    assert expected <= table_names
    assert len(expected) == 40
