"""add project.read/.update to test_manager bundle

Revision ID: b7f3a1c9d2e4
Revises: 34053c46f9fc
Create Date: 2026-09-03 00:00:00.000001

RBAC-3/ADR-0021: `test_manager`'s bundle (`app/db/rbac_seed_catalog.py`) was
missing `project.read`/`project.update` — a pre-existing RBAC-4 gap
surfaced while implementing this story's regression case (TC-RBAC-035): a
Project's own creator is auto-granted this Role, project-scoped,
unconditionally (PROJ-1/ADR-0017), specifically so they can subsequently
`GET`/`PATCH` the project they just created without also needing org-wide
`org_admin` — which only holds if the bundle actually grants those two
codes. `34053c46f9fc` (the original RBAC-4 seed migration) already recomputes
`build_role_bundles()` fresh and inserts only missing `(role_id,
permission_id)` pairs, so a brand-new environment that hasn't run that
migration yet already picks up the corrected bundle from
`rbac_seed_catalog.py` with no further action needed. This migration exists
solely to backfill the same two rows into any environment where
`34053c46f9fc` already ran before this fix landed — existence-checked, a
no-op if `34053c46f9fc` hasn't run yet in a given environment (in which case
its own now-corrected bundle build already covers it) or if these rows
already exist.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7f3a1c9d2e4'
down_revision: Union[str, None] = '34053c46f9fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies, same pattern as `34053c46f9fc`.
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

_MISSING_CODES = ("project.read", "project.update")


def upgrade() -> None:
    bind = op.get_bind()

    test_manager_role_id = bind.execute(
        sa.select(role_table.c.id).where(role_table.c.org_id.is_(None), role_table.c.name == "test_manager")
    ).scalar_one_or_none()
    if test_manager_role_id is None:
        # 34053c46f9fc hasn't run yet in this environment (unusual — it's
        # this migration's own down_revision) — nothing to backfill; its own
        # (now-corrected) bundle build will seed the right rows when it runs.
        return

    permission_ids = {
        row[0]: row[1]
        for row in bind.execute(
            sa.select(permission_table.c.code, permission_table.c.id).where(
                permission_table.c.code.in_(_MISSING_CODES)
            )
        )
    }
    if len(permission_ids) != len(_MISSING_CODES):
        # Catalog rows themselves are missing too (shouldn't happen — RBAC-4
        # seeds the full CRUD catalog for "project" unconditionally) — skip
        # rather than fail; nothing to link to.
        return

    existing_pairs = {
        row[0]
        for row in bind.execute(
            sa.select(role_permission_table.c.permission_id).where(
                role_permission_table.c.role_id == test_manager_role_id,
                role_permission_table.c.permission_id.in_(permission_ids.values()),
            )
        )
    }

    new_rows = [
        {"id": uuid.uuid4(), "role_id": test_manager_role_id, "permission_id": permission_id}
        for permission_id in permission_ids.values()
        if permission_id not in existing_pairs
    ]
    if new_rows:
        bind.execute(sa.insert(role_permission_table), new_rows)


def downgrade() -> None:
    bind = op.get_bind()

    test_manager_role_id = bind.execute(
        sa.select(role_table.c.id).where(role_table.c.org_id.is_(None), role_table.c.name == "test_manager")
    ).scalar_one_or_none()
    if test_manager_role_id is None:
        return

    permission_ids = [
        row[0]
        for row in bind.execute(
            sa.select(permission_table.c.id).where(permission_table.c.code.in_(_MISSING_CODES))
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
