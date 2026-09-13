"""seed test_type catalog

Revision ID: 854917c76ac5
Revises: f19a7c3e5b62
Create Date: 2026-09-13 00:00:00.000000

TESTTYPE-1: `TestType` ships full CRUD (ADR-0022 generic factory) but zero
seeded rows — confirmed empty on `main` itself, blocking the TestCase
create/edit form's TestType dropdown out of the box (see ADMIN-1's own
TC-ADMIN-001 precondition, and root `CLAUDE.md`'s "TestLevel/TestType ship
with full CRUD but zero seeded rows" note). Seeds 5 ISTQB CTFL v4.0.1-aligned
default rows (NFR-5). `TestLevel` deliberately left unseeded — out of scope
for this story, its own future seed is a separate decision.

Existence-checked by `name` (idempotent, re-runnable), same pattern as
`34053c46f9fc_seed_rbac_system_roles.py`.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '854917c76ac5'
down_revision: Union[str, None] = 'f19a7c3e5b62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxy (Alembic-recommended pattern for data
# migrations — not the app's ORM model), so this migration keeps working
# even if `app/models/taxonomy.py` changes shape later.
test_type_table = sa.table(
    "test_type",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
)

SEED_NAMES = [
    "Functional Testing",
    "Non-functional Testing",
    "Black-box Testing",
    "White-box Testing",
    "Confirmation Testing",
]


def upgrade() -> None:
    bind = op.get_bind()
    existing_names = {
        row[0] for row in bind.execute(sa.select(test_type_table.c.name))
    }
    new_rows = [
        {"id": uuid.uuid4(), "name": name}
        for name in SEED_NAMES
        if name not in existing_names
    ]
    if new_rows:
        bind.execute(sa.insert(test_type_table), new_rows)


def downgrade() -> None:
    # Delete only these 5 named rows — any admin-added custom TestType rows
    # (or a future story's own additions) are left untouched.
    bind = op.get_bind()
    bind.execute(sa.delete(test_type_table).where(test_type_table.c.name.in_(SEED_NAMES)))
