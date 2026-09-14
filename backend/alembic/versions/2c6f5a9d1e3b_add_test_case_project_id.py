"""add test_case.project_id (REQ-5 standalone authoring, ADR-0069)

Revision ID: 2c6f5a9d1e3b
Revises: 854917c76ac5
Create Date: 2026-09-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '2c6f5a9d1e3b'
down_revision: Union[str, None] = '854917c76ac5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands manually written to match the autogenerate style of
    # fbf02a6e4764_initial_schema.py. Additive, nullable column — REQ-5's
    # standalone TestCase authoring path (ADR-0069): a TestCase can now be
    # scoped directly to a Project, the same shape TestSuite already has,
    # with no Requirement/TestCondition link required. ###
    op.add_column('test_case', sa.Column('project_id', sa.Uuid(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'test_case_project_id_fkey', 'test_case', 'project', ['project_id'], ['id'], ondelete='RESTRICT'
    )
    # ### end commands ###


def downgrade() -> None:
    # ### commands manually written, mirroring upgrade() in reverse ###
    op.drop_constraint('test_case_project_id_fkey', 'test_case', type_='foreignkey')
    op.drop_column('test_case', 'project_id')
    # ### end commands ###
