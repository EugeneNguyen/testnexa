"""seed ai_agent permissions

Revision ID: d33d66f4b3c3
Revises: 40af3d77bb97
Create Date: 2026-09-03 00:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd33d66f4b3c3'
down_revision: Union[str, None] = '40af3d77bb97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Generated once at module import time, not freshly inside upgrade() — the
# actual id values don't matter to anything (nothing FKs to a specific
# literal Permission.id at seed time; `RolePermission` rows created later,
# by test fixtures or RBAC-4, look these rows up by `code`), this just keeps
# the two inserted rows' ids stable and inspectable within a single run.
_AI_AGENT_CREATE_ID = uuid.uuid4()
_AI_AGENT_UPDATE_ID = uuid.uuid4()

# Lightweight `sa.table`/`sa.column` reflection (not the real ORM model) —
# the standard Alembic data-migration pattern, so this migration doesn't
# depend on `app.models.rbac.Permission` and stays correct even if that
# model changes shape later (migrations are a frozen historical record).
permission_table = sa.table(
    'permission',
    sa.column('id', sa.Uuid()),
    sa.column('code', sa.String()),
    sa.column('resource', sa.String()),
    sa.column('action', sa.String()),
)


def upgrade() -> None:
    # AUTH-4/ADR-0015: seeds exactly the two Permission catalog rows this
    # story's own routes (`app/api/routes/agents.py`) need —
    # `ai_agent.create` / `ai_agent.update` — via a data migration, matching
    # RBAC-4's stated pattern of seeding via data migration rather than a
    # UI/API flow. This is NOT the full canonical permission catalog or
    # seeded system roles (`Role`/`RoleAssignment`) — that remains RBAC-4's
    # job; this story's own tests seed `Role`/`RoleAssignment` rows directly
    # via fixtures against these two `Permission` rows (ADR-0015's stated
    # fixture-bypass precedent, matching AUTH-1's precedent for
    # `User`/`Organization`/`OrgMembership`).
    op.bulk_insert(
        permission_table,
        [
            {
                'id': _AI_AGENT_CREATE_ID,
                'code': 'ai_agent.create',
                'resource': 'ai_agent',
                'action': 'create',
            },
            {
                'id': _AI_AGENT_UPDATE_ID,
                'code': 'ai_agent.update',
                'resource': 'ai_agent',
                'action': 'update',
            },
        ],
    )


def downgrade() -> None:
    # Deletes by `code`, not by the ids generated above — those ids are
    # process-local to a single `upgrade()` run and not guaranteed stable
    # across a downgrade invoked in a different process/import; `code` is
    # the actual unique, meaningful identity of these two seeded rows.
    op.execute(
        permission_table.delete().where(
            permission_table.c.code.in_(['ai_agent.create', 'ai_agent.update'])
        )
    )
