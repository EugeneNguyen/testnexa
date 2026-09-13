"""seed test level catalog

Revision ID: 63f8478c1c12
Revises: f19a7c3e5b62
Create Date: 2026-09-13 00:00:00.000000

ADMIN-5 (ADR-0066): seeds the global-catalog `test_level` table with the 5
ISTQB CTFL v4.0.1 test levels. Closes FR-ADMIN-1 AC1's own pre-existing
"seeded via Alembic data migration" claim for `TestLevel` only —
`TestType`/`TestDesignTechnique` remain unseeded, deliberately out of
scope (no canonical vocabulary decided for either yet).
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '63f8478c1c12'
down_revision: Union[str, None] = 'f19a7c3e5b62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same shape as `34053c46f9fc_seed_rbac_system_roles.py`: a lightweight
# `sa.table()` proxy, not the app's own `TestLevel` ORM model, so this
# migration keeps working even if that model's shape changes later.
test_level_table = sa.table(
    "test_level",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
)

TEST_LEVEL_NAMES = [
    "Component Testing",
    "Component Integration Testing",
    "System Testing",
    "System Integration Testing",
    "Acceptance Testing",
]


def upgrade() -> None:
    bind = op.get_bind()

    # Existence-checked by `name` (the table's own pre-existing unique
    # constraint would raise on a naive re-insert rather than no-op) —
    # same idempotent-seed shape NFR-20 already established for RBAC-4.
    existing_names = {
        row[0] for row in bind.execute(sa.select(test_level_table.c.name))
    }

    new_rows = [
        {"id": uuid.uuid4(), "name": name}
        for name in TEST_LEVEL_NAMES
        if name not in existing_names
    ]
    if new_rows:
        bind.execute(sa.insert(test_level_table), new_rows)


def downgrade() -> None:
    # Delete only the 5 seeded rows, by name — never a blanket
    # `DELETE FROM test_level`, so a row created independently after the
    # seed (e.g. via the existing generic `POST /test-levels` route)
    # survives a downgrade untouched.
    bind = op.get_bind()
    bind.execute(
        sa.delete(test_level_table).where(
            test_level_table.c.name.in_(TEST_LEVEL_NAMES)
        )
    )
