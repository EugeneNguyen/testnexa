"""add test_case.description

Revision ID: 9a2f7c4d8b1e
Revises: 2c6f5a9d1e3b
Create Date: 2026-09-15 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '9a2f7c4d8b1e'
down_revision: Union[str, None] = '2c6f5a9d1e3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py. Additive, nullable column — a short
    # summary of what's under test, separate from `preconditions`/
    # `expected_result`'s own narrower roles. ###
    op.add_column('test_case', sa.Column('description', sa.Text(), nullable=True))
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_column('test_case', 'description')
    # ### end commands ###
