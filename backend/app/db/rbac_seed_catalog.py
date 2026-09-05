"""RBAC-4 seed data: the `Permission` catalog and the 5 system `Role` bundles.

Pure-Python data structures, deliberately factored out of the Alembic
migration (`alembic/versions/<hash>_seed_rbac_system_roles.py`) so:

- the migration itself stays a thin "existence-check then INSERT" loop over
  these structures, and
- the shape (resource/action counts, which bundle contains what) is unit
  testable without a DB (see `tests/unit/test_rbac_seed_catalog.py`).

Source of truth: Database Document §3.3 and the RBAC-4 plan
(`docs/superpowers/plans/2026-09-03-rbac-4-seeded-system-roles-plan.md`).
No DB/network access happens in this module — it only builds in-memory
lists/sets of `(resource, action)` / permission-code tuples.
"""

from __future__ import annotations

STANDARD_ACTIONS: tuple[str, ...] = ("create", "read", "update", "delete")

# 23 resources with full CRUD (create/read/update/delete).
CRUD_RESOURCES: tuple[str, ...] = (
    "organization",
    "org_membership",
    "role",
    "role_assignment",
    "project",
    "release",
    "requirement",
    "test_condition",
    "test_case",
    "test_step",
    "test_suite",
    "test_plan",
    "entry_exit_criteria",
    "test_cycle",
    "environment",
    "test_execution",
    "defect",
    "risk_item",
    "attachment",
    "test_design_technique",
    "test_level",
    "test_type",
    "approval",
)

# 6 resources that are read-only (system-appended / no direct write API).
READ_ONLY_RESOURCES: tuple[str, ...] = (
    "permission",
    "test_log",
    "requirement_test_case_link",
    "requirement_test_condition_link",
    "test_condition_test_case_link",
    "test_case_defect_link",
)

# 29 resources total (23 CRUD + 6 read-only), per the plan/Database Document.
ALL_RESOURCES: tuple[str, ...] = CRUD_RESOURCES + READ_ONLY_RESOURCES

# 2 special verbs beyond CRUD.
SPECIAL_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("test_plan", "approve"),
    ("requirement", "export_rtm"),
)

# The 5 seeded system roles (org_id=NULL, is_system_role=True).
SYSTEM_ROLE_NAMES: tuple[str, ...] = (
    "org_admin",
    "test_manager",
    "tester",
    "auditor",
    "ai_agent_scoped",
)


def _code(resource: str, action: str) -> str:
    return f"{resource}.{action}"


def build_permission_catalog() -> list[tuple[str, str, str]]:
    """Return the full `(code, resource, action)` catalog — ~100 rows.

    23 CRUD resources x 4 actions (92) + 6 read-only resources x 1 action (6)
    + 2 special verbs (2) = 100 total.
    """
    catalog: list[tuple[str, str, str]] = []

    for resource in CRUD_RESOURCES:
        for action in STANDARD_ACTIONS:
            catalog.append((_code(resource, action), resource, action))

    for resource in READ_ONLY_RESOURCES:
        catalog.append((_code(resource, "read"), resource, "read"))

    for resource, action in SPECIAL_PERMISSIONS:
        catalog.append((_code(resource, action), resource, action))

    return catalog


def _crud_codes(resource: str, actions: tuple[str, ...] = STANDARD_ACTIONS) -> set[str]:
    return {_code(resource, action) for action in actions}


def _read_codes(resources: tuple[str, ...]) -> set[str]:
    return {_code(resource, "read") for resource in resources}


def build_role_bundles(all_permission_codes: set[str]) -> dict[str, set[str]]:
    """Return `{role_name: {permission codes}}` for the 5 system roles.

    `all_permission_codes` must be the full catalog's code set (see
    `build_permission_catalog`) — `org_admin`'s bundle is defined as "every
    permission that exists", not a hand-maintained duplicate list, so it
    can never silently drift from the catalog.
    """
    test_manager = (
        _crud_codes("test_plan")
        | {_code("test_plan", "approve")}
        | _crud_codes("entry_exit_criteria")
        | _crud_codes("test_cycle")
        | _crud_codes("test_suite")
        # PROJ-2/ADR-0018: create/read/update only, deliberately NOT
        # `.delete` — no delete route exists to reach it. `test_manager`
        # already held full `test_cycle` CRUD; withholding `release.*` was
        # an oversight in the original RBAC-4 seed (ADR-0018's Alternatives
        # section), closed here rather than left as a considered boundary.
        | _crud_codes("release", ("create", "read", "update"))
        | {_code("approval", "create"), _code("approval", "read")}
        | {_code("requirement", "read"), _code("requirement", "export_rtm")}
        | {_code("defect", "read")}
        | _crud_codes("risk_item")
        | {_code("test_case", "read"), _code("test_step", "read"), _code("test_condition", "read")}
        # RBAC-3/ADR-0021: a project's own creator is auto-granted this Role,
        # project-scoped, unconditionally (PROJ-1/ADR-0017's `create_project`)
        # specifically so they can subsequently GET/PATCH the project they
        # just created without also needing org-wide `org_admin` — that only
        # holds if the bundle actually grants `project.read`/`.update`
        # (pre-existing RBAC-4 gap surfaced by TC-RBAC-035; a "test manager"
        # role that can manage everything *inside* a project but can't view
        # or rename the project itself was never a deliberate restriction —
        # no story text asks for `test_manager` to be blocked from its own
        # project's read/update, and ADR-0021's own regression case is only
        # provable if these two codes are present).
        | {_code("project", "read"), _code("project", "update")}
    )

    tester = (
        _crud_codes("test_case")
        | _crud_codes("test_step")
        | _crud_codes("test_condition")
        | _crud_codes("test_execution")
        | {_code("test_log", "read")}
        | {_code("defect", "create"), _code("defect", "read"), _code("defect", "update")}
        | {_code("test_plan", "read")}
        | {_code("test_suite", "read")}
        | {_code("requirement", "read")}
    )

    auditor = _read_codes(ALL_RESOURCES) | {_code("requirement", "export_rtm")}

    ai_agent_scoped = (
        {_code("test_case", "create"), _code("test_case", "read"), _code("test_case", "update")}
        | {_code("test_step", "create"), _code("test_step", "read"), _code("test_step", "update")}
        | {
            _code("test_execution", "create"),
            _code("test_execution", "read"),
            _code("test_execution", "update"),
        }
        | {_code("test_log", "read")}
    )

    return {
        "org_admin": set(all_permission_codes),
        "test_manager": test_manager,
        "tester": tester,
        "auditor": auditor,
        "ai_agent_scoped": ai_agent_scoped,
    }
