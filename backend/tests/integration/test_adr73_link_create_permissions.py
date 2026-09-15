"""ADR-0073 integration: the live RBAC state migration `3e6b08c5da71` produces.

Covers TC-ADMIN-072 (the four `Permission` rows and every grant exist against a
real, migrated database) and TC-ADMIN-073 (re-running `upgrade()` inserts
nothing).

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
"""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.db.rbac_seed_catalog import LINK_CREATE_RESOURCES, build_permission_catalog, build_role_bundles
from app.db.session import AsyncSessionLocal
from app.models.rbac import Permission, Role, RolePermission

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "3e6b08c5da71_seed_trace_link_create_permissions.py"
)
_spec = importlib.util.spec_from_file_location("adr73_seed_migration_integration", _MIGRATION_PATH)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)

NEW_CODES = tuple(f"{resource}.create" for resource in LINK_CREATE_RESOURCES)


async def _codes_for_role(role_name: str) -> set[str]:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .where(Role.org_id.is_(None), Role.name == role_name)
        )
        return {row[0] for row in rows}


@pytest.mark.asyncio
async def test_the_four_link_create_permissions_exist_in_the_live_catalog() -> None:  # TC-ADMIN-072
    async with AsyncSessionLocal() as session:
        rows = await session.execute(select(Permission).where(Permission.code.in_(NEW_CODES)))
        permissions = {p.code: p for p in rows.scalars().all()}

    assert set(permissions) == set(NEW_CODES), sorted(set(NEW_CODES) - set(permissions))
    for code, permission in permissions.items():
        # `resource`/`action` are not decoration — `has_permission` and the
        # RBAC-2 admin surface both read them, and a row whose columns
        # disagree with its own code is unreachable through either.
        assert permission.action == "create", code
        assert code == f"{permission.resource}.create", code


@pytest.mark.asyncio
async def test_org_admin_still_holds_every_permission_after_the_new_rows() -> None:  # TC-ADMIN-072
    """`org_admin`'s bundle is defined as "every permission that exists"
    (`build_role_bundles`'s contract). Inserting `Permission` rows without
    granting them here is the specific way this migration could break a live
    invariant that predates it (TC-RBAC-018) — asserted directly rather than
    relying on that other test to notice.
    """
    async with AsyncSessionLocal() as session:
        total = (await session.execute(select(func.count()).select_from(Permission))).scalar_one()
    assert len(await _codes_for_role("org_admin")) == total


@pytest.mark.asyncio
async def test_test_manager_holds_all_four_creates_and_all_four_reads() -> None:  # TC-ADMIN-072
    """Read and write together — without the `.read`, the ADR-0071 tab the
    write action lives on `403`s before the button can render."""
    codes = await _codes_for_role("test_manager")
    for resource in LINK_CREATE_RESOURCES:
        assert f"{resource}.create" in codes, resource
        assert f"{resource}.read" in codes, resource


@pytest.mark.asyncio
async def test_tester_holds_only_the_defect_link_create() -> None:  # TC-ADMIN-072
    codes = await _codes_for_role("tester")
    assert "test_case_defect_link.create" in codes
    assert "test_case_defect_link.read" in codes
    for resource in LINK_CREATE_RESOURCES:
        if resource != "test_case_defect_link":
            assert f"{resource}.create" not in codes, resource


@pytest.mark.asyncio
async def test_auditor_gained_no_write_and_still_holds_every_read() -> None:  # TC-ADMIN-072
    codes = await _codes_for_role("auditor")
    assert not (codes & set(NEW_CODES))
    for resource in LINK_CREATE_RESOURCES:
        assert f"{resource}.read" in codes, resource


@pytest.mark.asyncio
async def test_the_live_grants_match_the_static_bundle_definitions() -> None:  # TC-ADMIN-072
    """A backfilled database and a freshly-seeded one must be indistinguishable
    for these codes. Compares the live `role_permission` rows against what
    `build_role_bundles` would produce, restricted to the codes this ADR
    touches — the whole-bundle comparison belongs to `test_rbac_seed.py`.
    """
    bundles = build_role_bundles({code for code, _, _ in build_permission_catalog()})
    touched = set(NEW_CODES) | {f"{resource}.read" for resource in LINK_CREATE_RESOURCES}
    for role_name in ("org_admin", "test_manager", "tester", "auditor", "ai_agent_scoped"):
        live = await _codes_for_role(role_name) & touched
        expected = bundles[role_name] & touched
        assert live == expected, (role_name, sorted(live ^ expected))


@pytest.mark.asyncio
async def test_seed_migration_upgrade_is_idempotent() -> None:  # TC-ADMIN-073
    """Direct double invocation — see this module's docstring for why the CLI
    cannot answer this question."""
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    from app.db.session import engine as app_engine

    async def _counts() -> tuple[int, int]:
        async with AsyncSessionLocal() as session:
            permissions = (
                await session.execute(select(func.count()).select_from(Permission))
            ).scalar_one()
            grants = (await session.execute(select(func.count()).select_from(RolePermission))).scalar_one()
            return permissions, grants

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
