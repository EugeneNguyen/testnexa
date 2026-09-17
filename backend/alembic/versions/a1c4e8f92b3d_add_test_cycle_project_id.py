"""add test_cycle.project_id, backfilled from test_plan (ADR-0084)

Revision ID: a1c4e8f92b3d
Revises: 8c1d5a7b93e2
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1c4e8f92b3d'
down_revision: Union[str, None] = '8c1d5a7b93e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py. Unlike test_case.project_id
    # (2c6f5a9d1e3b, nullable — a standalone TestCase legitimately has no
    # Project), every TestCycle already has exactly one Project transitively
    # via test_plan_id, so this column is NOT NULL from the start: add
    # nullable, backfill from the existing test_plan.project_id, then
    # tighten. ADR-0084. ###
    op.add_column('test_cycle', sa.Column('project_id', sa.Uuid(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE test_cycle
        SET project_id = test_plan.project_id
        FROM test_plan
        WHERE test_cycle.test_plan_id = test_plan.id
        """
    )
    op.alter_column('test_cycle', 'project_id', nullable=False)
    op.create_foreign_key(
        'test_cycle_project_id_fkey', 'test_cycle', 'project', ['project_id'], ['id'], ondelete='RESTRICT'
    )
    op.create_index('ix_test_cycle_project_id', 'test_cycle', ['project_id'])
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_index('ix_test_cycle_project_id', table_name='test_cycle')
    op.drop_constraint('test_cycle_project_id_fkey', 'test_cycle', type_='foreignkey')
    op.drop_column('test_cycle', 'project_id')
    # ### end commands ###
