"""ADR-0077 integration: the live RBAC state migration `8c1d5a7b93e2` produces.

Covers TC-ADMIN-113 (the four `Permission` rows and every grant exist against a
real, migrated database) and TC-ADMIN-114 (re-running `upgrade()` inserts
nothing, and a mutation check proving that assertion is not vacuous).

Read-only against the seeded catalog except for the idempotency test, which
re-invokes the migration's own `upgrade()` — deliberately a no-op if the
migration is correct, and the assertion is that it *is*.

**The idempotency test does NOT shell out to `alembic upgrade head` a second
time.** `backend/CLAUDE.md` documents (from ADMIN-5/TC-ADMIN-041) that a second
CLI call against a database already at that revision is a pure no-op at
Alembic's own bookkeeping layer: no `Running upgrade ...` line, and the
migration file's `upgrade()` body never re-executes at all. A `before == after`
assertion around that call passes identically whether the existence-check logic
is correct or completely broken, because nothing ran to be idempotent about.
`upgrade()` is therefore invoked **directly, twice**, through a real
`alembic.operations.Operations` context bound to the app's own async engine —
the same technique `alembic/env.py` uses to run migrations against an async
driver — which bypasses the revision table entirely so both calls genuinely
execute their SQL.

**And that is still not sufficient on its own**, which is where this file goes
one step past its ADR-0076 sibling. "Two invocations changed no row counts" is
also what you would observe if the invocations silently did nothing at all — a
mis-imported module, a `_GRANTS` dict that had gone empty, a bind that was
never reached. `test_the_idempotency_check_can_actually_observe_a_write` runs
the *same* harness around a deliberately non-idempotent write and asserts the
counts **do** move, so "no change" and "the harness cannot see change" are
distinguishable results — the in-suite mutation discipline ADR-0075 established
and `backend/CLAUDE.md` generalizes.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

from app.db.rbac_seed_catalog import LINK_DELETE_RESOURCES, build_permission_catalog, build_role_bundles
from app.db.session import AsyncSessionLocal
from app.models.rbac import Permission, Role, RolePermission

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "8c1d5a7b93e2_seed_trace_link_delete_permissions.py"
)
_spec = importlib.util.spec_from_file_location("adr77_seed_migration_integration", _MIGRATION_PATH)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)

NEW_CODES = tuple(f"{resource}.delete" for resource in LINK_DELETE_RESOURCES)


async def _codes_for_role(role_name: str) -> set[str]:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .where(Role.org_id.is_(None), Role.name == role_name)
        )
        return {row[0] for row in rows}


async def _counts() -> tuple[int, int]:
    async with AsyncSessionLocal() as session:
        permissions = (await session.execute(select(func.count()).select_from(Permission))).scalar_one()
        grants = (await session.execute(select(func.count()).select_from(RolePermission))).scalar_one()
        return permissions, grants


@pytest.mark.asyncio
async def test_the_four_link_delete_permissions_exist_in_the_live_catalog() -> None:  # TC-ADMIN-113
    async with AsyncSessionLocal() as session:
        rows = await session.execute(select(Permission).where(Permission.code.in_(NEW_CODES)))
        permissions = {p.code: p for p in rows.scalars().all()}

    assert set(permissions) == set(NEW_CODES), sorted(set(NEW_CODES) - set(permissions))
    for code, permission in permissions.items():
        # `resource`/`action` are not decoration — `has_permission` and the
        # RBAC-2 admin surface both read them, and a row whose columns disagree
        # with its own code is unreachable through either.
        assert permission.action == "delete", code
        assert code == f"{permission.resource}.delete", code


@pytest.mark.asyncio
async def test_org_admin_still_holds_every_permission_after_the_new_rows() -> None:  # TC-ADMIN-113
    """`org_admin`'s bundle is defined as "every permission that exists"
    (`build_role_bundles`'s contract). Inserting `Permission` rows without
    granting them here is the specific way this migration could break a live
    invariant that predates it (TC-RBAC-018) — asserted directly rather than
    relying on that other test to notice.
    """
    total, _ = await _counts()
    assert len(await _codes_for_role("org_admin")) == total


@pytest.mark.asyncio
async def test_test_manager_holds_all_four_deletes_alongside_its_creates_and_reads() -> None:  # TC-ADMIN-113
    """The full triple, per link. `.read` makes the tab render, `.create` puts
    rows in it, `.delete` takes them back out — and this is the one role that
    owns the RTM those rows populate (`requirement.export_rtm`), so the three
    are asserted together rather than the new code alone.
    """
    codes = await _codes_for_role("test_manager")
    for resource in LINK_DELETE_RESOURCES:
        assert f"{resource}.read" in codes, resource
        assert f"{resource}.create" in codes, resource
        assert f"{resource}.delete" in codes, resource


@pytest.mark.asyncio
async def test_tester_holds_only_the_defect_link_delete() -> None:  # TC-ADMIN-113
    """ADR-0077's restraint decision, live: exactly the undo of the one link
    this role may create, and nothing requirement-level."""
    codes = await _codes_for_role("tester")
    assert "test_case_defect_link.delete" in codes
    assert "test_case_defect_link.create" in codes, "the write it undoes"
    for resource in LINK_DELETE_RESOURCES:
        if resource != "test_case_defect_link":
            assert f"{resource}.delete" not in codes, resource


@pytest.mark.asyncio
async def test_auditor_gained_no_write_and_still_holds_every_read() -> None:  # TC-ADMIN-113
    codes = await _codes_for_role("auditor")
    assert not (codes & set(NEW_CODES))
    for resource in LINK_DELETE_RESOURCES:
        assert f"{resource}.read" in codes, resource


@pytest.mark.asyncio
async def test_ai_agent_scoped_gained_nothing() -> None:  # TC-ADMIN-113
    codes = await _codes_for_role("ai_agent_scoped")
    assert not (codes & set(NEW_CODES))


@pytest.mark.asyncio
async def test_the_live_grants_match_the_static_bundle_definitions() -> None:  # TC-ADMIN-113
    """A backfilled database and a freshly-seeded one must be indistinguishable
    for these codes. Compares the live `role_permission` rows against what
    `build_role_bundles` would produce, restricted to the codes this ADR
    touches — the whole-bundle comparison belongs to `test_rbac_seed.py`.
    """
    bundles = build_role_bundles({code for code, _, _ in build_permission_catalog()})
    touched = set(NEW_CODES)
    for role_name in ("org_admin", "test_manager", "tester", "auditor", "ai_agent_scoped"):
        live = await _codes_for_role(role_name) & touched
        expected = bundles[role_name] & touched
        assert live == expected, (role_name, sorted(live ^ expected))


@pytest.mark.asyncio
async def test_seed_migration_upgrade_is_idempotent() -> None:  # TC-ADMIN-114
    """Direct double invocation — see this module's docstring for why the CLI
    cannot answer this question, and why the mutation check below is needed
    before this result means anything."""
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    from app.db.session import engine as app_engine

    before = await _counts()

    def _run_upgrade_twice(sync_conn) -> None:
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            _migration.upgrade()
            _migration.upgrade()

    async with app_engine.connect() as conn:
        await conn.run_sync(_run_upgrade_twice)
        await conn.commit()

    assert await _counts() == before


@pytest.mark.asyncio
async def test_the_idempotency_check_can_actually_observe_a_write() -> None:  # TC-ADMIN-114
    """The mutation half — `backend/CLAUDE.md`'s "a verification the framework
    can silently skip is not a verification", applied to the *harness* rather
    than to the migration.

    The test above asserts two `upgrade()` calls move no counts. That reading
    is identical to the one a harness that never reached the database would
    produce. So the same `Operations`-context machinery is pointed at a
    deliberately non-idempotent insert (a throwaway `Permission` row with a
    random code, no existence check) and the counts are asserted to move by
    exactly one — then the row is removed again.

    If this fails, the idempotency result above is meaningless and must not be
    read as a pass.
    """
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    from app.db.session import engine as app_engine

    throwaway_code = f"adr77_mutation_probe.{uuid.uuid4().hex[:12]}"
    before = await _counts()

    def _insert_unconditionally(sync_conn) -> None:
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            # Deliberately NOT existence-checked — that is the whole point.
            sync_conn.execute(
                _migration.permission_table.insert().values(
                    id=uuid.uuid4(),
                    code=throwaway_code,
                    resource="adr77_mutation_probe",
                    action="delete",
                )
            )

    try:
        async with app_engine.connect() as conn:
            await conn.run_sync(_insert_unconditionally)
            await conn.commit()

        after = await _counts()
        assert after[0] == before[0] + 1, (
            "the idempotency harness above cannot observe a write at all, so its "
            "'nothing changed' result proves nothing about the migration"
        )
        assert after[1] == before[1], "the probe grants nothing, so grants must not move"
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(Permission).where(Permission.code == throwaway_code))
            await session.commit()

    assert await _counts() == before, "the probe row must not outlive this test"
