"""add ai_agent.last_used_at

Revision ID: 40af3d77bb97
Revises: 3ea2dea9a1db
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '40af3d77bb97'
down_revision: Union[str, None] = '3ea2dea9a1db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py — no live DB available to autogenerate
    # against at implementation time (AUTH-4, ADR-0015). Additive, nullable
    # column: the AC3 `AuthIdentity.last_login_at`-equivalent for AIAgent
    # sessions, NULL until an agent's first successful bearer-key auth. ###
    op.add_column('ai_agent', sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_column('ai_agent', 'last_used_at')
    # ### end commands ###
