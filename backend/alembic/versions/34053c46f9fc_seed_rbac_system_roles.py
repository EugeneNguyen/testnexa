"""seed rbac system roles

Revision ID: 34053c46f9fc
Revises: 3ea2dea9a1db
Create Date: 2026-09-03 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.rbac_seed_catalog import (
    SYSTEM_ROLE_NAMES,
    build_permission_catalog,
    build_role_bundles,
)

# revision identifiers, used by Alembic.
revision: str = '34053c46f9fc'
down_revision: Union[str, None] = '3ea2dea9a1db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models from `app/models/rbac.py`, so this
# migration keeps working even if those models change shape later).
permission_table = sa.table(
    "permission",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String()),
    sa.column("resource", sa.String()),
    sa.column("action", sa.String()),
)

role_table = sa.table(
    "role",
    sa.column("id", sa.Uuid()),
    sa.column("org_id", sa.Uuid()),
    sa.column("name", sa.String()),
    sa.column("is_system_role", sa.Boolean()),
)

role_permission_table = sa.table(
    "role_permission",
    sa.column("id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
    sa.column("permission_id", sa.Uuid()),
)


def upgrade() -> None:
    # RBAC-4: partial unique index (prevents duplicate system-role
    # templates; per-org custom roles are entirely unaffected since their
    # `org_id IS NOT NULL`). A plain `UniqueConstraint(org_id, name)` would
    # NOT work here — Postgres treats `NULL <> NULL`, so two
    # `(NULL, 'org_admin')` rows would not collide under a standard
    # composite unique constraint. Raw DDL with `IF NOT EXISTS` (rather than
    # `op.create_index`) so re-running this migration is a no-op instead of
    # a duplicate-index error.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_role_name_system_role "
            "ON role (name) WHERE org_id IS NULL"
        )
    )

    # --- Permission catalog (existence-checked by code) --------------------
    catalog = build_permission_catalog()  # [(code, resource, action), ...]
    existing_codes = {row[0] for row in bind.execute(sa.select(permission_table.c.code))}

    new_permissions = [
        {"id": uuid.uuid4(), "code": code, "resource": resource, "action": action}
        for code, resource, action in catalog
        if code not in existing_codes
    ]
    if new_permissions:
        bind.execute(sa.insert(permission_table), new_permissions)

    # Re-read the full code -> id map: covers both pre-existing rows (a
    # re-run) and the ones just inserted above.
    code_to_id: dict[str, uuid.UUID] = {
        row[0]: row[1]
        for row in bind.execute(sa.select(permission_table.c.code, permission_table.c.id))
    }

    # --- 5 system Role rows (existence-checked by name WHERE org_id IS NULL) --
    existing_roles = bind.execute(
        sa.select(role_table.c.name, role_table.c.id).where(role_table.c.org_id.is_(None))
    ).all()
    role_name_to_id: dict[str, uuid.UUID] = {row[0]: row[1] for row in existing_roles}

    new_roles = []
    for name in SYSTEM_ROLE_NAMES:
        if name not in role_name_to_id:
            new_id = uuid.uuid4()
            role_name_to_id[name] = new_id
            new_roles.append({"id": new_id, "org_id": None, "name": name, "is_system_role": True})
    if new_roles:
        bind.execute(sa.insert(role_table), new_roles)

    # --- RolePermission bundle rows (existence-checked by (role_id, permission_id)) --
    all_codes = {code for code, _resource, _action in catalog}
    bundles = build_role_bundles(all_codes)  # {role_name: {codes}}

    role_ids = list(role_name_to_id.values())
    existing_pairs = {
        (row[0], row[1])
        for row in bind.execute(
            sa.select(
                role_permission_table.c.role_id, role_permission_table.c.permission_id
            ).where(role_permission_table.c.role_id.in_(role_ids))
        )
    }

    new_role_permissions = []
    for role_name, codes in bundles.items():
        role_id = role_name_to_id[role_name]
        for code in codes:
            permission_id = code_to_id[code]
            pair = (role_id, permission_id)
            if pair not in existing_pairs:
                new_role_permissions.append(
                    {"id": uuid.uuid4(), "role_id": role_id, "permission_id": permission_id}
                )
                existing_pairs.add(pair)
    if new_role_permissions:
        bind.execute(sa.insert(role_permission_table), new_role_permissions)


def downgrade() -> None:
    # Delete only the 5 system Role rows (by name, org_id IS NULL) —
    # RolePermission rows cascade-delete via the existing FK
    # (`role_permission.role_id` -> `role.id`, `ondelete="CASCADE"`).
    # `Permission` catalog rows are deliberately left in place: they're a
    # shared global catalog other roles/stories may already reference.
    bind = op.get_bind()
    bind.execute(
        sa.delete(role_table)
        .where(role_table.c.org_id.is_(None))
        .where(role_table.c.name.in_(SYSTEM_ROLE_NAMES))
    )
    bind.execute(sa.text("DROP INDEX IF EXISTS uq_role_name_system_role"))
