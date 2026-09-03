"""add login_attempt table

Revision ID: 2134936456d6
Revises: fbf02a6e4764
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '2134936456d6'
down_revision: Union[str, None] = 'fbf02a6e4764'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py — no live DB available to autogenerate
    # against at implementation time (AUTH-1, ADR-0011 login throttle). ###
    op.create_table('login_attempt',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('client_ip', sa.String(), nullable=False),
    sa.Column('succeeded', sa.Boolean(), nullable=False),
    sa.Column('attempted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_login_attempt_email'), 'login_attempt', ['email'], unique=False)
    op.create_index(op.f('ix_login_attempt_client_ip'), 'login_attempt', ['client_ip'], unique=False)
    op.create_index('ix_login_attempt_email_ip_attempted_at', 'login_attempt', ['email', 'client_ip', 'attempted_at'], unique=False)
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_index('ix_login_attempt_email_ip_attempted_at', table_name='login_attempt')
    op.drop_index(op.f('ix_login_attempt_client_ip'), table_name='login_attempt')
    op.drop_index(op.f('ix_login_attempt_email'), table_name='login_attempt')
    op.drop_table('login_attempt')
    # ### end commands ###
