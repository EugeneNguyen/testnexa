"""seed test_suite_test_case/test_plan_test_suite read permissions

Revision ID: 7d2c91af4e68
Revises: 9a2f7c4d8b1e
Create Date: 2026-09-15 00:00:00.000000

ADR-0075: `app/db/rbac_seed_catalog.py`'s `READ_ONLY_RESOURCES` gains two
entries — `test_suite_test_case` and `test_plan_test_suite`, REQ-4's and
PLAN-1's junction tables, which ADR-0075 registers as read-only generic-CRUD
entities so `crud_factory.derive_entity_relations` (ADR-0074) can see the
many-to-many relationships they carry.

**This migration is the first RBAC extension in this repo that has to insert
the `Permission` rows themselves, not just `role_permission` grants.** Every
prior extension (`b7f3a1c9d2e4`, `c7479d1b7cf6`, `a91c4e0f7db5`,
`e5b21d7c8f40`, `f19a7c3e5b62`) widened a bundle with a code the RBAC-4 catalog
already contained; `f19a7c3e5b62`'s own docstring says so explicitly ("The
`Permission` rows themselves already exist... so this migration only inserts
the missing `role_permission` rows"). Here the *resources* are new, so the two
`<resource>.read` codes do not exist in any already-seeded database and both
halves are needed:

1. insert the two missing `permission` rows, then
2. grant them to the four bundles that must hold them.

Which bundles, and why each:

- **`org_admin`** — its bundle is defined as "every permission that exists"
  (`build_role_bundles`'s own contract, and `34053c46f9fc`'s
  `build_role_bundles(set(code_to_id.keys()))` call). Inserting a `Permission`
  row without granting it here would break the live invariant
  `tests/integration/test_rbac_seed.py::test_org_admin_has_every_permission`
  (TC-RBAC-018) asserts — `org_admin`'s `role_permission` count equals the
  total `Permission` count.
- **`auditor`** — defined as `_read_codes(ALL_RESOURCES)`, i.e. `.read` on
  every resource. Same reasoning: the static definition already includes the
  new codes, so an already-seeded DB needs the backfill to match it.
- **`test_manager`** and **`tester`** — both already hold
  `test_suite.read`/`test_plan.read`, so both can open those detail pages; the
  junction tables' generic `list`/`get` gate on the junctions' *own* `.read`
  codes, so without these grants the ADR-0074 relationship tab on a `TestSuite`
  or `TestPlan` would `403` for exactly the two roles that use those screens.
  Same shape as ADR-0044's `test_case_defect_link.read` grant to the same two
  roles.

`ai_agent_scoped` is deliberately **not** granted either code: its bundle holds
no `test_suite`/`test_plan` read at all, so it cannot reach either detail page,
and granting a junction read it could never use would be a silent scope
expansion no acceptance criterion asks for — the same restraint ADR-0033 took
for `test_execution.update`/`.delete`.

On a **fresh** database this migration is a pure no-op: `34053c46f9fc` runs
first and seeds the catalog from `build_permission_catalog()`'s *current* code
(now 102 rows) plus every bundle, so both permissions and all four grants
already exist by the time this runs. It only does real work against a database
seeded before ADR-0075 landed.

Idempotent existence-check-then-insert throughout, mirroring `34053c46f9fc`'s
permission seeding and `f19a7c3e5b62`'s grant seeding verbatim — re-running is
a no-op. `downgrade()` removes the grants and then the two `permission` rows,
reversing both halves.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7d2c91af4e68'
down_revision: Union[str, None] = '9a2f7c4d8b1e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Lightweight `sa.table()` proxies (Alembic-recommended pattern for data
# migrations — NOT the app's ORM models), same as every prior RBAC-extension
# migration in this repo.
permission_table = sa.table(
    "permission",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String()),
    sa.column("resource", sa.String()),
    sa.column("action", sa.String()),
)

role_table = sa.table(
    "role",
    sa.column("id", sa.Uuid()),
    sa.column("org_id", sa.Uuid()),
    sa.column("name", sa.String()),
)

role_permission_table = sa.table(
    "role_permission",
    sa.column("id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
    sa.column("permission_id", sa.Uuid()),
)

#: The two brand-new catalog rows, as `(code, resource, action)` — the same
#: triple shape `build_permission_catalog()` emits. A unit test asserts this
#: tuple is exactly the delta between the pre- and post-ADR-0075 catalogs, so
#: it cannot drift from `rbac_seed_catalog.READ_ONLY_RESOURCES`.
_NEW_PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("test_suite_test_case.read", "test_suite_test_case", "read"),
    ("test_plan_test_suite.read", "test_plan_test_suite", "read"),
)

_NEW_CODES: tuple[str, ...] = tuple(code for code, _, _ in _NEW_PERMISSIONS)

#: Every role that must hold both new codes. All four are grants the *static*
#: bundle definitions already produce for a fresh DB (`org_admin` = everything,
#: `auditor` = read-on-everything, and the two explicit additions ADR-0075 makes
#: to `test_manager`/`tester`) — this list exists only to backfill a DB seeded
#: before those definitions changed.
_ROLES_TO_GRANT: tuple[str, ...] = ("org_admin", "auditor", "test_manager", "tester")


def _role_id(bind: sa.engine.Connection, role_name: str) -> uuid.UUID | None:
    return bind.execute(
        sa.select(role_table.c.id).where(
            role_table.c.org_id.is_(None), role_table.c.name == role_name
        )
    ).scalar_one_or_none()


def _insert_missing_permissions(bind: sa.engine.Connection) -> None:
    """Existence-checked by `code`, mirroring `34053c46f9fc`'s own catalog seed."""
    existing_codes = {
        row[0]
        for row in bind.execute(
            sa.select(permission_table.c.code).where(permission_table.c.code.in_(_NEW_CODES))
        )
    }
    new_rows = [
        {"id": uuid.uuid4(), "code": code, "resource": resource, "action": action}
        for code, resource, action in _NEW_PERMISSIONS
        if code not in existing_codes
    ]
    if new_rows:
        bind.execute(sa.insert(permission_table), new_rows)


def _grant(bind: sa.engine.Connection, role_name: str, codes: tuple[str, ...]) -> None:
    role_id = _role_id(bind, role_name)
    if role_id is None:
        # 34053c46f9fc hasn't run yet in this environment — nothing to
        # backfill; its own bundle build seeds the right rows when it runs.
        return

    code_to_permission_id: dict[str, uuid.UUID] = {
        row[0]: row[1]
        for row in bind.execute(
            sa.select(permission_table.c.code, permission_table.c.id).where(
                permission_table.c.code.in_(codes)
            )
        )
    }
    if len(code_to_permission_id) != len(codes):
        # `_insert_missing_permissions` runs first, so this should be
        # unreachable — skip rather than fail if it somehow isn't; there would
        # be nothing to link to.
        return

    existing_permission_ids = {
        row[0]
        for row in bind.execute(
            sa.select(role_permission_table.c.permission_id).where(
                role_permission_table.c.role_id == role_id,
                role_permission_table.c.permission_id.in_(code_to_permission_id.values()),
            )
        )
    }

    new_role_permissions = [
        {"id": uuid.uuid4(), "role_id": role_id, "permission_id": permission_id}
        for permission_id in code_to_permission_id.values()
        if permission_id not in existing_permission_ids
    ]
    if new_role_permissions:
        bind.execute(sa.insert(role_permission_table), new_role_permissions)


def upgrade() -> None:
    bind = op.get_bind()
    _insert_missing_permissions(bind)
    for role_name in _ROLES_TO_GRANT:
        _grant(bind, role_name, _NEW_CODES)


def downgrade() -> None:
    bind = op.get_bind()
    permission_ids = [
        row[0]
        for row in bind.execute(
            sa.select(permission_table.c.id).where(permission_table.c.code.in_(_NEW_CODES))
        )
    ]
    if not permission_ids:
        return

    # Grants first — `role_permission.permission_id` FKs `permission.id`, so
    # deleting the catalog rows while grants still reference them would violate
    # that constraint. Deleted for EVERY role, not just `_ROLES_TO_GRANT`: a
    # per-org custom role may have been granted one of these codes through the
    # normal RBAC-2 surface since this migration ran, and leaving an orphaned
    # grant behind would block the permission delete below.
    bind.execute(
        sa.delete(role_permission_table).where(
            role_permission_table.c.permission_id.in_(permission_ids)
        )
    )
    bind.execute(sa.delete(permission_table).where(permission_table.c.id.in_(permission_ids)))
