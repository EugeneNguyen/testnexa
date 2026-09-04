"""seed release permissions test_manager

Revision ID: c7479d1b7cf6
Revises: 34053c46f9fc
Create Date: 2026-09-04 00:00:00.000000

PROJ-2/ADR-0018: `test_manager`'s seeded bundle gains `release.create`/
`.read`/`.update` (deliberately NOT `.delete` — no delete route exists to
reach it). The `Permission` rows themselves already exist (seeded by
`34053c46f9fc`'s full catalog, since `release` is one of `CRUD_RESOURCES`
in `rbac_seed_catalog.py`) — this migration only inserts the 3 new
`RolePermission` rows linking the existing `test_manager` system `Role`
(`org_id IS NULL`) to those existing `Permission` rows.

Existence-checked insert (mirrors `34053c46f9fc`'s idempotent-re-run style,
NOT `d33d66f4b3c3`'s unconditional `bulk_insert` style) — this migration
must be safely re-runnable since it's the second data migration touching
`test_manager`'s bundle after `34053c46f9fc` itself.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7479d1b7cf6'
down_revision: Union[str, None] = '34053c46f9fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models), same as `34053c46f9fc`.
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

_NEW_CODES = ("release.create", "release.read", "release.update")


def upgrade() -> None:
    bind = op.get_bind()

    # Look up the existing test_manager system Role (org_id IS NULL).
    test_manager_role_id = bind.execute(
        sa.select(role_table.c.id).where(
            role_table.c.org_id.is_(None), role_table.c.name == "test_manager"
        )
    ).scalar_one()

    # Look up the existing release.create/.read/.update Permission rows.
    code_to_permission_id: dict[str, uuid.UUID] = {
        row[0]: row[1]
        for row in bind.execute(
            sa.select(permission_table.c.code, permission_table.c.id).where(
                permission_table.c.code.in_(_NEW_CODES)
            )
        )
    }
    missing = set(_NEW_CODES) - set(code_to_permission_id.keys())
    if missing:
        raise RuntimeError(
            f"expected Permission rows {sorted(missing)} to already be seeded "
            "by 34053c46f9fc's full catalog"
        )

    # Existence-checked insert: only add RolePermission pairs that don't
    # already exist, so re-running this migration is a no-op.
    existing_permission_ids = {
        row[0]
        for row in bind.execute(
            sa.select(role_permission_table.c.permission_id).where(
                role_permission_table.c.role_id == test_manager_role_id
            )
        )
    }

    new_role_permissions = [
        {"id": uuid.uuid4(), "role_id": test_manager_role_id, "permission_id": permission_id}
        for code, permission_id in code_to_permission_id.items()
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
