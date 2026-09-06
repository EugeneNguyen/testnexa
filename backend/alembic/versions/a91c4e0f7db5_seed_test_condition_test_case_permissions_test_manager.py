"""seed test_condition/test_case permissions test_manager

Revision ID: a91c4e0f7db5
Revises: 0ffc2d802eab
Create Date: 2026-09-06 00:00:00.000000

REQ-3/ADR-0028: `test_manager`'s seeded bundle
(`app/db/rbac_seed_catalog.py`) gains full CRUD on `test_condition` and
`test_case` — `test_condition.create`/`.update`/`.delete` and
`test_case.create`/`.update`/`.delete`, the 6 codes it didn't already hold
(it has had `.read` on both since RBAC-4). Parity with `tester`'s existing
bundle, which has held full CRUD on both resources all along.

Without this, FR-REQ-3's own persona — a compliance QA manager holding
`test_manager` — cannot reach either of this story's two new authoring routes
(`POST /requirements/{id}/test-conditions`, `POST /test-conditions/{id}/test-cases`)
without also being granted `tester` or `org_admin`, which the story's text
never asks for. Same shape of pre-existing RBAC-4 seed gap that
`b7f3a1c9d2e4` (`project.read`/`.update`) and `c7479d1b7cf6` (`release.*`)
each closed once before, and this migration mirrors their idempotent
existence-check-then-insert shape verbatim.

The `Permission` rows themselves already exist (seeded by `34053c46f9fc`'s
full catalog — `test_condition`/`test_case` are both in `CRUD_RESOURCES`), so
this migration only inserts the 6 missing `role_permission` rows linking the
existing `test_manager` system `Role` (`org_id IS NULL`) to them. A brand-new
environment that hasn't run `34053c46f9fc` yet needs nothing from this
migration at all: that one recomputes `build_role_bundles()` fresh and so
already picks up the corrected bundle from `rbac_seed_catalog.py`.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a91c4e0f7db5'
down_revision: Union[str, None] = '0ffc2d802eab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models), same as `34053c46f9fc`/
# `b7f3a1c9d2e4`/`c7479d1b7cf6`.
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
    "test_condition.create",
    "test_condition.update",
    "test_condition.delete",
    "test_case.create",
    "test_case.update",
    "test_case.delete",
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

    # Look up the existing test_condition.*/test_case.* Permission rows.
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
