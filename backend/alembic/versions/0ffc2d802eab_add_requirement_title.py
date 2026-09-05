"""add requirement.title

Revision ID: 0ffc2d802eab
Revises: 41d945e0286a
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0ffc2d802eab'
down_revision: Union[str, None] = '41d945e0286a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py — no live DB available to autogenerate
    # against at implementation time (REQ-1, ADR-0025). Non-nullable, no
    # default: this scaffold has shipped no production data, so a plain
    # `nullable=False` add is sufficient here, not a two-step
    # nullable-then-backfill-then-constrain migration (see ADR-0025's
    # Decision section for the explicit rationale). ###
    op.add_column('requirement', sa.Column('title', sa.String(), nullable=False))
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_column('requirement', 'title')
    # ### end commands ###
