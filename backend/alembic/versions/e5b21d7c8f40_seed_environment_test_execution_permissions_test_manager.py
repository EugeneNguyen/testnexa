"""seed environment/test_execution permissions test_manager

Revision ID: e5b21d7c8f40
Revises: a91c4e0f7db5
Create Date: 2026-09-06 00:00:00.000000

PLAN-3/ADR-0033: `test_manager`'s seeded bundle (`app/db/rbac_seed_catalog.py`)
gains full CRUD on `environment` (`environment.create`/`.read`/`.update`/
`.delete` — it held none of the four) plus `test_execution.create` and
`test_execution.read` (it held neither). Six codes total.

Two distinct reasons, both from ADR-0033 §Decision:

- **`environment.*`** — a pre-existing RBAC-4 seed gap of exactly the shape
  `c7479d1b7cf6` closed for `release.*` and `a91c4e0f7db5` for
  `test_condition.*`/`test_case.*`. `test_manager` has held full `test_cycle`
  CRUD since RBAC-4, but a `TestCycle` cannot be created without pointing at an
  `Environment`, and FR-PLAN-3 AC2's own text ("a user with
  `environment.create` permission…") names this story's persona directly.
  Without this, PLAN-3's inline "+ New Environment" flow 403s for the very role
  the story is written around.
- **`test_execution.create`/`.read`** — the minimum to reach ADR-0033's new
  bespoke `POST /test-cycles/{id}/executions` route (TC-PLAN-008) and read the
  result back. `.update`/`.delete` are deliberately **not** granted: no
  FR-PLAN-3 or FR-EXEC-1 acceptance criterion asks `test_manager` to edit or
  delete a recorded result, and granting them here would be a silent scope
  expansion. EXEC-1/EXEC-3 write their own migration if they need them.

The `Permission` rows themselves already exist (seeded by `34053c46f9fc`'s full
catalog — `environment`/`test_execution` are both in `CRUD_RESOURCES`), so this
migration only inserts the missing `role_permission` rows linking the existing
`test_manager` system `Role` (`org_id IS NULL`) to them. A brand-new
environment that hasn't run `34053c46f9fc` yet needs nothing from this
migration at all: that one recomputes `build_role_bundles()` fresh and so
already picks up the corrected bundle from `rbac_seed_catalog.py`.

Idempotent existence-check-then-insert, mirroring `a91c4e0f7db5`/
`b7f3a1c9d2e4`/`c7479d1b7cf6` verbatim — re-running is a no-op.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5b21d7c8f40'
down_revision: Union[str, None] = 'a91c4e0f7db5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models), same as `34053c46f9fc`/
# `b7f3a1c9d2e4`/`c7479d1b7cf6`/`a91c4e0f7db5`.
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

_NEW_CODES = (
    "environment.create",
    "environment.read",
    "environment.update",
    "environment.delete",
    "test_execution.create",
    "test_execution.read",
)


def upgrade() -> None:
    bind = op.get_bind()

    # Look up the existing test_manager system Role (org_id IS NULL).
    test_manager_role_id = bind.execute(
        sa.select(role_table.c.id).where(
            role_table.c.org_id.is_(None), role_table.c.name == "test_manager"
        )
    ).scalar_one_or_none()
    if test_manager_role_id is None:
        # 34053c46f9fc hasn't run yet in this environment — nothing to
        # backfill; its own (now-corrected) bundle build seeds the right rows
        # when it runs.
        return

    # Look up the existing environment.*/test_execution.* Permission rows.
    code_to_permission_id: dict[str, uuid.UUID] = {
        row[0]: row[1]
        for row in bind.execute(
            sa.select(permission_table.c.code, permission_table.c.id).where(
                permission_table.c.code.in_(_NEW_CODES)
            )
        )
    }
    if len(code_to_permission_id) != len(_NEW_CODES):
        # Catalog rows themselves are missing too (shouldn't happen — RBAC-4
        # seeds full CRUD for both resources unconditionally) — skip rather
        # than fail; nothing to link to.
        return

    # Existence-checked insert: only add RolePermission pairs that don't
    # already exist, so re-running this migration is a no-op.
    existing_permission_ids = {
        row[0]
        for row in bind.execute(
            sa.select(role_permission_table.c.permission_id).where(
                role_permission_table.c.role_id == test_manager_role_id,
                role_permission_table.c.permission_id.in_(code_to_permission_id.values()),
            )
        )
    }

    new_role_permissions = [
        {"id": uuid.uuid4(), "role_id": test_manager_role_id, "permission_id": permission_id}
        for permission_id in code_to_permission_id.values()
        if permission_id not in existing_permission_ids
    ]
    if new_role_permissions:
        bind.execute(sa.insert(role_permission_table), new_role_permissions)


def downgrade() -> None:
    bind = op.get_bind()

    test_manager_role_id = bind.execute(
        sa.select(role_table.c.id).where(
            role_table.c.org_id.is_(None), role_table.c.name == "test_manager"
        )
    ).scalar_one_or_none()
    if test_manager_role_id is None:
        return

    permission_ids = [
        row[0]
        for row in bind.execute(
            sa.select(permission_table.c.id).where(permission_table.c.code.in_(_NEW_CODES))
        )
    ]
    if not permission_ids:
        return

    bind.execute(
        sa.delete(role_permission_table).where(
            role_permission_table.c.role_id == test_manager_role_id,
            role_permission_table.c.permission_id.in_(permission_ids),
        )
    )
