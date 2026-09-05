"""add partial unique index for org-wide role_assignment rows

Revision ID: c4a8e5f21b03
Revises: b7f3a1c9d2e4
Create Date: 2026-09-04 00:00:00.000000

RBAC-3/TC-RBAC-029: the existing `uq_role_assignment_actor_org_project_role`
`UniqueConstraint` on `(actor_id, org_id, project_id, role_id)` does not stop
two ORG-WIDE grants (`project_id IS NULL`) for the same
`(actor_id, org_id, role_id)` from coexisting — standard SQL treats
`NULL <> NULL`, so Postgres never considers two NULL `project_id` values a
match for that constraint. This is a pre-existing gap in the initial schema
migration (`fbf02a6e4764`), surfaced for the first time by RBAC-3's own
create-route regression test (the first story to insert `RoleAssignment`
rows through a real `POST` endpoint that could plausibly collide). Same
partial-unique-index fix already applied to `Role.uq_role_name_system_role`
for the identical `NULL`-uniqueness problem (`app/models/rbac.py`).

Adds a partial unique index on `(actor_id, org_id, role_id) WHERE project_id
IS NULL`, applying only to org-wide rows and leaving the existing composite
constraint (which correctly catches project-scoped duplicates, since
non-null `project_id` values compare equal as expected) untouched.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4a8e5f21b03'
down_revision: Union[str, None] = 'b7f3a1c9d2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_role_assignment_actor_org_role_when_org_wide",
        "role_assignment",
        ["actor_id", "org_id", "role_id"],
        unique=True,
        postgresql_where=sa.text("project_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_role_assignment_actor_org_role_when_org_wide", table_name="role_assignment")
