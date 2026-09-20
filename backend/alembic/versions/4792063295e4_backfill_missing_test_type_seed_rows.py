"""backfill missing test_type seed rows

Revision ID: 4792063295e4
Revises: a1c4e8f92b3d
Create Date: 2026-09-20 00:00:00.000000

`854917c76ac5_seed_test_type_catalog.py`'s own `upgrade()` is idempotent
(existence-check-then-insert), but `alembic upgrade head` is a pure no-op
once a DB is already at that revision -- it never re-enters the function
body (see `backend/CLAUDE.md`'s Alembic-idempotency note). `main`'s own
live `test_type` table was found missing "Confirmation Testing" (root
cause unknown -- most likely a downgrade/upgrade cycle run by some other
test session that never got a real re-run of the seed migration's own
logic afterward), and every isolated stack cloned from `main`'s DB
inherits the gap. Re-running the exact same existence-check-then-insert
here, chained as a NEW revision, is the only way to make the seed
migration's own idempotency claim actually self-heal an environment
that's already past its original revision -- same pattern as this repo's
other RBAC-bundle backfill migrations (`backend/CLAUDE.md`'s "RBAC bundle
extensions always need a new data migration" note).
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '4792063295e4'
down_revision: Union[str, None] = 'a1c4e8f92b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

test_type_table = sa.table(
    "test_type",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
)

# Identical to `854917c76ac5_seed_test_type_catalog.py`'s own SEED_NAMES.
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
    # No-op, deliberately: this migration only ever inserts rows the
    # original seed migration's own downgrade() already knows how to
    # remove (it deletes by the same SEED_NAMES list) -- reversing this one
    # too would double up with that removal for no benefit.
    pass
