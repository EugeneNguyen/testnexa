"""role_assignment.project_id FK becomes ON DELETE CASCADE (was RESTRICT)

Revision ID: 6a11a6a1d803
Revises: e5b21d7c8f40
Create Date: 2026-09-07 00:00:00.000000

DASH-2/ADR-0040: found during DASH-2's own isolated-env manual verification
that `DELETE /projects/{id}` (ADR-0022's generic factory, just given its
first frontend caller by DASH-2's Project-table "Delete" button) 409s
`restrict_blocked` for literally every Project ever created through the
app's own `POST /orgs/{org_id}/projects` route — that route unconditionally
grants the creator a project-scoped `test_manager` RoleAssignment (ADR-0017
step 5), and `role_assignment.project_id` was `ON DELETE RESTRICT`.

A project-scoped RoleAssignment has no meaning once its own Project is
gone — there's no "orphaned scope" state worth preserving here the way
there might be for, say, a Requirement or TestCase a user would want to
recover. Cascading the RoleAssignment away when its Project is deleted is
the correct semantics, not a workaround. This does NOT touch any other
entity's FK to `project.id` (Release/Requirement/TestSuite/TestPlan/
Environment/RiskItem/Attachment, etc. all keep their own `RESTRICT` —
deleting a Project that still has real content should still fail, which is
correct and unrelated to this fix).

Existing Postgres FK constraints can't have `ON DELETE` altered in place —
drop and recreate under the same constraint name (`role_assignment_project_
id_fkey`, confirmed via `\\d role_assignment` against a real running
instance) so no application code or other tooling needs to know the name
changed.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6a11a6a1d803'
down_revision: Union[str, None] = 'e5b21d7c8f40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("role_assignment_project_id_fkey", "role_assignment", type_="foreignkey")
    op.create_foreign_key(
        "role_assignment_project_id_fkey",
        "role_assignment",
        "project",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("role_assignment_project_id_fkey", "role_assignment", type_="foreignkey")
    op.create_foreign_key(
        "role_assignment_project_id_fkey",
        "role_assignment",
        "project",
        ["project_id"],
        ["id"],
        ondelete="RESTRICT",
    )
