"""seed defect/test_case_defect_link permissions test_manager tester

Revision ID: f19a7c3e5b62
Revises: 6a11a6a1d803
Create Date: 2026-09-08 00:00:00.000000

EXEC-3/ADR-0041: `app/db/rbac_seed_catalog.py`'s seeded bundles gain two new
grants:

- **`test_manager` + `defect.create`** — held only `defect.read` before. The
  minimum to reach the new `POST /executions/{id}/defects` (Priya's own
  persona, established since PLAN-3/ADR-0033, is `test_manager`).
  `.update`/`.delete` deliberately not granted — no FR-EXEC-3 AC asks for
  editing/deleting a raised Defect, same restraint ADR-0033 already took for
  `test_execution.*`. Fifth such ad hoc extension for this role (after
  `release.*`; `test_condition.*`/`test_case.*`; `environment.*`/
  `test_execution.create`+`.read`).
- **`test_manager` + `tester` both + `test_case_defect_link.read`** — neither
  role held it before (only `org_admin`/`auditor` did). Needed to reach the
  new `GET /test-cases/{id}/defects` ordered view (AC3).

The `Permission` rows themselves already exist (`defect`/
`test_case_defect_link` are both already in the RBAC-4 catalog — `defect` in
`CRUD_RESOURCES`, `test_case_defect_link` in `READ_ONLY_RESOURCES`), so this
migration only inserts the missing `role_permission` rows.

Idempotent existence-check-then-insert, mirroring `e5b21d7c8f40`/
`a91c4e0f7db5`/`b7f3a1c9d2e4`/`c7479d1b7cf6` verbatim — re-running is a no-op.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f19a7c3e5b62'
down_revision: Union[str, None] = '6a11a6a1d803'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models), same as every prior RBAC-extension
# migration in this repo.
permission_table = sa.table(
    "permission",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String()),
)

role_table = sa.table(
    "role",
    sa.column("id", sa.Uuid()),
    sa.column("org_id", sa.Uuid()),
    sa.column("name", sa.String()),
)

role_permission_table = sa.table(
    "role_permission",
    sa.column("id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
    sa.column("permission_id", sa.Uuid()),
)

# Per-role code sets — distinct from the environment/test_execution migration
# above, `test_manager` and `tester` need different new codes here.
_TEST_MANAGER_NEW_CODES = ("defect.create", "test_case_defect_link.read")
_TESTER_NEW_CODES = ("test_case_defect_link.read",)
_ALL_NEW_CODES = tuple(set(_TEST_MANAGER_NEW_CODES) | set(_TESTER_NEW_CODES))


def _role_id(bind: sa.engine.Connection, role_name: str) -> uuid.UUID | None:
    return bind.execute(
        sa.select(role_table.c.id).where(
            role_table.c.org_id.is_(None), role_table.c.name == role_name
        )
    ).scalar_one_or_none()


def _grant(bind: sa.engine.Connection, role_name: str, codes: tuple[str, ...]) -> None:
    role_id = _role_id(bind, role_name)
    if role_id is None:
        # 34053c46f9fc hasn't run yet in this environment — nothing to
        # backfill; its own (now-corrected) bundle build seeds the right rows
        # when it runs.
        return

    code_to_permission_id: dict[str, uuid.UUID] = {
        row[0]: row[1]
        for row in bind.execute(
            sa.select(permission_table.c.code, permission_table.c.id).where(
                permission_table.c.code.in_(codes)
            )
        )
    }
    if len(code_to_permission_id) != len(codes):
        # Catalog rows themselves are missing too (shouldn't happen) — skip
        # rather than fail; nothing to link to.
        return

    existing_permission_ids = {
        row[0]
        for row in bind.execute(
            sa.select(role_permission_table.c.permission_id).where(
                role_permission_table.c.role_id == role_id,
                role_permission_table.c.permission_id.in_(code_to_permission_id.values()),
            )
        )
    }

    new_role_permissions = [
        {"id": uuid.uuid4(), "role_id": role_id, "permission_id": permission_id}
        for permission_id in code_to_permission_id.values()
        if permission_id not in existing_permission_ids
    ]
    if new_role_permissions:
        bind.execute(sa.insert(role_permission_table), new_role_permissions)


def _revoke(bind: sa.engine.Connection, role_name: str, codes: tuple[str, ...]) -> None:
    role_id = _role_id(bind, role_name)
    if role_id is None:
        return

    permission_ids = [
        row[0]
        for row in bind.execute(
            sa.select(permission_table.c.id).where(permission_table.c.code.in_(codes))
        )
    ]
    if not permission_ids:
        return

    bind.execute(
        sa.delete(role_permission_table).where(
            role_permission_table.c.role_id == role_id,
            role_permission_table.c.permission_id.in_(permission_ids),
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    _grant(bind, "test_manager", _TEST_MANAGER_NEW_CODES)
    _grant(bind, "tester", _TESTER_NEW_CODES)


def downgrade() -> None:
    bind = op.get_bind()
    _revoke(bind, "test_manager", _TEST_MANAGER_NEW_CODES)
    _revoke(bind, "tester", _TESTER_NEW_CODES)
