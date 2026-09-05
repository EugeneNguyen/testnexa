"""merge rbac3 and main heads

Revision ID: 41d945e0286a
Revises: c4a8e5f21b03, c7479d1b7cf6
Create Date: 2026-09-05 07:46:56.324578

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '41d945e0286a'
down_revision: Union[str, None] = ('c4a8e5f21b03', 'c7479d1b7cf6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
