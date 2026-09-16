"""seed delete permissions for the 4 traceability link tables

Revision ID: 8c1d5a7b93e2
Revises: 3e6b08c5da71
Create Date: 2026-09-16 00:00:00.000000

ADR-0077: `app/api/routes/trace.py` gains one bespoke `DELETE` per ADR-0005
traceability link table, beside the `POST` ADR-0076 added, each gated on a
**new** `<resource>.delete` permission code. `app/db/rbac_seed_catalog.py`
declares them via the new `LINK_DELETE_RESOURCES` tuple (catalog 106 -> 110
rows), but editing that module alone only affects a *fresh* database's initial
seed — an already-seeded one needs this backfill (`backend/CLAUDE.md`'s
standing rule, now its eighth instance).

Shaped verbatim on `3e6b08c5da71` (ADR-0076's own sibling), which is the one
migration in this repo doing the closest thing: like it, and unlike the five
grant-only extensions before it, this has to insert the `Permission` rows
themselves as well as the `role_permission` grants, because the four codes are
brand new and exist in no already-seeded database.

Which bundles, and why each — matching `build_role_bundles`' own static
definitions exactly, so a fresh DB and a backfilled one end up identical:

- **`org_admin`** — its bundle *is* "every permission that exists"
  (`build_role_bundles`'s contract). Inserting a `Permission` row without
  granting it here breaks the live invariant
  `tests/integration/test_rbac_seed.py::test_org_admin_has_every_permission`
  (TC-RBAC-018) asserts: `org_admin`'s `role_permission` count equals the
  total `Permission` count.
- **`test_manager`** — all four `.delete` codes, symmetric with the four
  `.create`s `3e6b08c5da71` granted it. It is the only bundle holding
  `requirement.export_rtm`, i.e. the role accountable for the traceability
  matrix being correct; granted the ability to assemble it (ADR-0076) and not
  to correct it, every mislink it makes would be permanent. Unlike the
  `.delete` codes this bundle is deliberately withheld (ADR-0018's `release`,
  ADR-0033's `test_execution`, ADR-0044's `defect`), a link row carries no
  content of its own — two FK columns and a timestamp (ADR-0005) — so removing
  one retracts an assertion rather than destroying recorded work.
  **No `.read` backfill is needed this time**: `3e6b08c5da71` already granted
  this role all four link `.read` codes, so the tab the unlink action lives on
  can already render.
- **`tester`** — `test_case_defect_link.delete` only, exactly mirroring the
  single `.create` it was granted. The unlink is the literal undo of the one
  link this role may make; without it a mislinked Defect needs an escalation to
  correct. The other three are withheld for the identical reason their
  `.create`s are: `tester` holds only `requirement.read`, and requirement-level
  traceability is `test_manager`'s activity.

**`auditor` needs no grant and gets none**: read-only by definition, and
ADR-0077 adds only `.delete` codes. **`ai_agent_scoped`** likewise not granted:
its bundle reaches no `requirement`/`defect`/link resource at all.

On a **fresh** database this migration is a pure no-op: `34053c46f9fc` runs
first and seeds the catalog from `build_permission_catalog()`'s *current* code
(110 rows) plus every bundle, so all four permissions and all six grants
already exist by the time this runs. It only does real work against a database
seeded before ADR-0077 landed.

Idempotent existence-check-then-insert throughout — re-running is a no-op,
proven by `tests/unit/test_adr77_seed_trace_link_delete_permissions.py`
invoking `upgrade()` **twice through a real `Operations` context**, not by a
second `alembic upgrade head` CLI call (which `backend/CLAUDE.md` documents as
a bookkeeping-level no-op that never re-enters this function at all).
`downgrade()` removes every grant of the four codes and then the four
`permission` rows, reversing both halves. It is **symmetric**, unlike
`3e6b08c5da71`'s, for the simple reason that this migration backfills no
pre-existing code onto any role: everything it writes, it owns.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c1d5a7b93e2'
down_revision: Union[str, None] = '3e6b08c5da71'
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

#: The four brand-new catalog rows, as `(code, resource, action)` — the same
#: triple shape `build_permission_catalog()` emits. A unit test asserts this
#: tuple is exactly the delta between the pre- and post-ADR-0077 catalogs, so
#: it cannot drift from `rbac_seed_catalog.LINK_DELETE_RESOURCES`.
_NEW_PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("requirement_test_case_link.delete", "requirement_test_case_link", "delete"),
    ("requirement_test_condition_link.delete", "requirement_test_condition_link", "delete"),
    ("test_condition_test_case_link.delete", "test_condition_test_case_link", "delete"),
    ("test_case_defect_link.delete", "test_case_defect_link", "delete"),
)

_NEW_CODES: tuple[str, ...] = tuple(code for code, _, _ in _NEW_PERMISSIONS)

#: `{role name: codes it must hold after this migration}`. Every entry is a
#: grant the *static* bundle definitions already produce for a fresh DB; this
#: mapping exists only to backfill a DB seeded before those definitions changed.
_GRANTS: dict[str, tuple[str, ...]] = {
    "org_admin": _NEW_CODES,
    "test_manager": _NEW_CODES,
    "tester": ("test_case_defect_link.delete",),
}


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
    for role_name, codes in _GRANTS.items():
        _grant(bind, role_name, codes)


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
    # that constraint. Deleted for EVERY role, not just `_GRANTS`' keys: a
    # per-org custom role may have been granted one of these codes through the
    # normal RBAC-2 surface since this migration ran, and leaving an orphaned
    # grant behind would block the permission delete below.
    bind.execute(
        sa.delete(role_permission_table).where(
            role_permission_table.c.permission_id.in_(permission_ids)
        )
    )
    bind.execute(sa.delete(permission_table).where(permission_table.c.id.in_(permission_ids)))
