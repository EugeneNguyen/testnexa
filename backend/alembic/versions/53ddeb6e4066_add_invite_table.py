"""add invite table

Revision ID: 53ddeb6e4066
Revises: 34053c46f9fc
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '53ddeb6e4066'
down_revision: Union[str, None] = '34053c46f9fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py — no live DB available to autogenerate
    # against at implementation time (RBAC-2, ADR-0017). New table, not on
    # the 07 ERD: invite-token mechanics for the "new email" invite path
    # (Database Document §3.1). `org_membership_id` and `token_hash` are
    # both unique — at most one live invite per membership, and
    # `token_hash` is `POST /invites/{token}/accept`'s lookup key, same
    # pattern as `refresh_token.token_hash`. ###
    op.create_table('invite',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('org_membership_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('invited_by_actor_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_membership_id'], ['org_membership.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['invited_by_actor_id'], ['actor.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_membership_id')
    )
    op.create_index(op.f('ix_invite_token_hash'), 'invite', ['token_hash'], unique=True)
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_index(op.f('ix_invite_token_hash'), table_name='invite')
    op.drop_table('invite')
    # ### end commands ###
