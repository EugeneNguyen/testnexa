"""seed create permissions for the 4 traceability link tables

Revision ID: 3e6b08c5da71
Revises: 7d2c91af4e68
Create Date: 2026-09-15 00:00:00.000000

ADR-0076: `app/api/routes/trace.py` gains one bespoke `POST` per ADR-0005
traceability link table, each gated on a **new** `<resource>.create`
permission code. `app/db/rbac_seed_catalog.py` declares them via the new
`LINK_CREATE_RESOURCES` tuple (catalog 102 -> 106 rows), but editing that
module alone only affects a *fresh* database's initial seed — an
already-seeded one needs this backfill (`backend/CLAUDE.md`'s standing rule,
now its seventh instance).

Like `7d2c91af4e68` (ADR-0075) and unlike the five extensions before it, this
migration has to insert the `Permission` rows themselves as well as the
`role_permission` grants: the four codes are brand new, so they exist in no
already-seeded database.

Which bundles, and why each — matching `build_role_bundles`' own static
definitions exactly, so a fresh DB and a backfilled one end up identical:

- **`org_admin`** — its bundle *is* "every permission that exists"
  (`build_role_bundles`'s contract). Inserting a `Permission` row without
  granting it here breaks the live invariant
  `tests/integration/test_rbac_seed.py::test_org_admin_has_every_permission`
  (TC-RBAC-018) asserts: `org_admin`'s `role_permission` count equals the
  total `Permission` count.
- **`test_manager`** — all four `.create` codes **plus the three `.read`
  codes it did not already hold** (`test_case_defect_link.read` came with
  ADR-0044). Read and write together deliberately: the write action lives on
  an ADR-0074 relationship tab whose own list request gates on the `.read`
  code, so granting `.create` alone would ship a button on a tab that `403`s
  before it can render. This is the traceability-owning role — the only
  bundle with `requirement.export_rtm`, and already holding full
  `test_condition`/`test_case` CRUD and `defect.create`, i.e. both ends of
  all four links.
- **`tester`** — `test_case_defect_link.create` only. It already holds that
  link's `.read` (ADR-0044) and full `defect` create/read/update, so
  "this failure is a defect that already exists" is a workflow it genuinely
  performs. The other three are withheld: `tester` holds only
  `requirement.read`, and requirement-level traceability is the
  `test_manager` persona's activity — granting it here would be a silent
  scope expansion no acceptance criterion asks for.

**`auditor` needs no grant and gets none**: its bundle is
`_read_codes(ALL_RESOURCES)`, the four link tables are already in
`READ_ONLY_RESOURCES`, so it has held all four `.read` codes since RBAC-4 —
and ADR-0076 adds only `.create` codes, which a read-only role must not hold.
**`ai_agent_scoped`** likewise not granted: its bundle reaches no
`requirement`/`defect`/link resource at all, so a link-create it could never
use would be pure scope expansion (the restraint ADR-0033 took for
`test_execution.update`/`.delete`).

On a **fresh** database this migration is a pure no-op: `34053c46f9fc` runs
first and seeds the catalog from `build_permission_catalog()`'s *current* code
(106 rows) plus every bundle, so all four permissions and all eight grants
already exist by the time this runs. It only does real work against a database
seeded before ADR-0076 landed.

Idempotent existence-check-then-insert throughout, mirroring `7d2c91af4e68`
verbatim — re-running is a no-op, proven by
`tests/unit/test_adr76_seed_trace_link_create_permissions.py` invoking
`upgrade()` **twice through a real `Operations` context**, not by a second
`alembic upgrade head` CLI call (which `backend/CLAUDE.md` documents as a
bookkeeping-level no-op that never re-enters this function at all).
`downgrade()` removes the grants and then the four `permission` rows,
reversing both halves — but **only the four `.create` rows**: the three
`.read` grants this migration backfills onto `test_manager` are for
permissions that predate it, so `downgrade()` revokes those grants without
touching the catalog rows themselves.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3e6b08c5da71'
down_revision: Union[str, None] = '7d2c91af4e68'
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
#: tuple is exactly the delta between the pre- and post-ADR-0076 catalogs, so
#: it cannot drift from `rbac_seed_catalog.LINK_CREATE_RESOURCES`.
_NEW_PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("requirement_test_case_link.create", "requirement_test_case_link", "create"),
    ("requirement_test_condition_link.create", "requirement_test_condition_link", "create"),
    ("test_condition_test_case_link.create", "test_condition_test_case_link", "create"),
    ("test_case_defect_link.create", "test_case_defect_link", "create"),
)

_NEW_CODES: tuple[str, ...] = tuple(code for code, _, _ in _NEW_PERMISSIONS)

#: Pre-existing `.read` codes `test_manager` did not hold — see this module's
#: docstring for why they are granted in the same migration as the writes.
_TEST_MANAGER_BACKFILL_READS: tuple[str, ...] = (
    "requirement_test_case_link.read",
    "requirement_test_condition_link.read",
    "test_condition_test_case_link.read",
)

#: `{role name: codes it must hold after this migration}`. Every entry is a
#: grant the *static* bundle definitions already produce for a fresh DB; this
#: mapping exists only to backfill a DB seeded before those definitions changed.
_GRANTS: dict[str, tuple[str, ...]] = {
    "org_admin": _NEW_CODES,
    "test_manager": _NEW_CODES + _TEST_MANAGER_BACKFILL_READS,
    "tester": ("test_case_defect_link.create",),
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
        # `_insert_missing_permissions` runs first and the `.read` codes
        # predate this migration, so this should be unreachable — skip rather
        # than fail if it somehow isn't; there would be nothing to link to.
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

    # The three pre-existing `.read` codes this migration backfilled onto
    # `test_manager`: revoke that role's grants, but never the catalog rows —
    # they predate ADR-0076 and other roles legitimately hold them.
    test_manager_id = _role_id(bind, "test_manager")
    if test_manager_id is not None:
        read_permission_ids = [
            row[0]
            for row in bind.execute(
                sa.select(permission_table.c.id).where(
                    permission_table.c.code.in_(_TEST_MANAGER_BACKFILL_READS)
                )
            )
        ]
        if read_permission_ids:
            bind.execute(
                sa.delete(role_permission_table).where(
                    role_permission_table.c.role_id == test_manager_id,
                    role_permission_table.c.permission_id.in_(read_permission_ids),
                )
            )

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
