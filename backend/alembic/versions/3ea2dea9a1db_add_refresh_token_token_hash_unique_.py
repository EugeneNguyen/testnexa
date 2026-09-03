"""add refresh_token.token_hash unique index

Revision ID: 3ea2dea9a1db
Revises: 2134936456d6
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3ea2dea9a1db'
down_revision: Union[str, None] = '2134936456d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py — no live DB available to autogenerate
    # against at implementation time (AUTH-2, ADR-0013). `token_hash` was
    # never indexed by AUTH-1 since nothing looked it up by value; AUTH-2's
    # POST /auth/refresh makes `WHERE token_hash = ?` a hot-path lookup on
    # every renewal, so it needs a unique index (also enforces the single-use
    # rotation invariant at the DB level, not just in application logic). ###
    op.create_index(op.f('ix_refresh_token_token_hash'), 'refresh_token', ['token_hash'], unique=True)
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_index(op.f('ix_refresh_token_token_hash'), table_name='refresh_token')
    # ### end commands ###
