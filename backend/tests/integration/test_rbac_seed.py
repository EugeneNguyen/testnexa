"""Integration tests for the RBAC-4 seed migration (`34053c46f9fc_seed_rbac_system_roles`).

Unlike `test_auth_login.py`/`test_auth_refresh.py`, this story adds **no REST
route** — `require_permission`/`has_permission` (`app/core/rbac.py`) are still
stubs (a separate story), and there is no `GET /roles`-style endpoint yet
(ADMIN-2, unbuilt). Real coverage for RBAC-4 is therefore entirely at the DB
level: this file asserts directly against the `role`/`permission`/
`role_permission` tables via `AsyncSessionLocal`, the same shared engine
`test_auth_login.py` uses for seeding/cleanup (session-scoped event loop,
already configured in `pyproject.toml`).

The package-level `tests/integration/conftest.py` fixture (`_require_live_server`,
autouse=True, session-scoped) still applies — it probes `{TEST_API_BASE_URL}/health`
and skips the whole integration suite if unreachable. That HTTP probe is the
*only* HTTP traffic this file causes; it is not itself RBAC-4 route coverage
(there is none to have), just proof the app process the DB changes ship
alongside still boots and serves.

Covers exactly the RBAC-4-scoped cases from
`docs/test-cases/2026-09-03-test-cases.md`: TC-RBAC-012, 013, 014, 016, 017,
018, 019. (TC-RBAC-015 is RBAC-5 scope, not implemented here.)

Alembic upgrade/downgrade cycles (TC-RBAC-016, TC-RBAC-019) shell out to the
`alembic` CLI already installed in this same virtualenv, against the same
`DATABASE_URL` the live server under test uses — this exercises the real
migration file, not a re-implementation of its logic in Python.
"""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.rbac_seed_catalog import SYSTEM_ROLE_NAMES
from app.db.session import AsyncSessionLocal
from app.models.rbac import Permission, Role, RolePermission
from app.models.tenancy import Organization

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/tests/integration/.. /.. -> backend/


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    """Shell out to the `alembic` CLI in this venv, against `DATABASE_URL`.

    `cwd=BACKEND_DIR` so `alembic.ini`'s relative `script_location = alembic`
    resolves correctly regardless of where pytest itself was invoked from.
    Inherits the current process's environment (including `DATABASE_URL`,
    which must point at the same Postgres the live server under test uses).
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,  # asserted explicitly by callers via `.returncode`
    )


async def _create_org(slug_prefix: str) -> Organization:
    async with AsyncSessionLocal() as session:
        org = Organization(name=f"RBAC Seed Test Org {slug_prefix}", slug=f"{slug_prefix}-{uuid4().hex[:8]}")
        session.add(org)
        await session.commit()
        await session.refresh(org)
        return org


async def _delete_org(org_id) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(Role.__table__.delete().where(Role.org_id == org_id))
        await session.execute(Organization.__table__.delete().where(Organization.id == org_id))
        await session.commit()


# --- TC-RBAC-012: all 5 system roles present, is_system_role=true, org_id IS NULL ----------


@pytest.mark.asyncio
async def test_all_five_system_roles_seeded() -> None:  # TC-RBAC-012
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Role).where(Role.org_id.is_(None)))
        system_roles = {role.name: role for role in result.scalars().all()}

    assert set(system_roles.keys()) == set(SYSTEM_ROLE_NAMES)
    for name in SYSTEM_ROLE_NAMES:
        role = system_roles[name]
        assert role.is_system_role is True
        assert role.org_id is None


# --- TC-RBAC-013: inserting a custom org-scoped Role succeeds, no collision with the ---------
# --- partial index (which only applies WHERE org_id IS NULL) --------------------------------


@pytest.mark.asyncio
async def test_custom_org_scoped_role_insert_succeeds() -> None:  # TC-RBAC-013
    org = await _create_org("tc013")
    try:
        async with AsyncSessionLocal() as session:
            # Deliberately reuse a system-role NAME ("org_admin") to prove the
            # partial index (`WHERE org_id IS NULL`) does not restrict
            # per-org custom roles at all, even ones that happen to share a
            # name with a system-role template.
            custom_role = Role(org_id=org.id, name="org_admin", is_system_role=False)
            session.add(custom_role)
            await session.commit()
            await session.refresh(custom_role)

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Role).where(Role.id == custom_role.id))
            fetched = result.scalar_one()
            assert fetched.org_id == org.id
            assert fetched.name == "org_admin"
            assert fetched.is_system_role is False
    finally:
        await _delete_org(org.id)


# --- TC-RBAC-014: ai_agent_scoped never has test_plan.approve --------------------------------


@pytest.mark.asyncio
async def test_ai_agent_scoped_role_never_has_test_plan_approve() -> None:  # TC-RBAC-014
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .where(Role.name == "ai_agent_scoped", Role.org_id.is_(None))
        )
        codes = {row[0] for row in result.all()}

    assert "test_plan.approve" not in codes
    assert len(codes) > 0  # sanity: the role does have *some* permissions


# --- TC-RBAC-016: re-running `alembic upgrade head` is idempotent ----------------------------


@pytest.mark.asyncio
async def test_migration_rerun_is_idempotent() -> None:  # TC-RBAC-016
    async def _counts() -> tuple[int, int, int]:
        async with AsyncSessionLocal() as session:
            role_count = (await session.execute(select(func.count()).select_from(Role))).scalar_one()
            permission_count = (
                await session.execute(select(func.count()).select_from(Permission))
            ).scalar_one()
            role_permission_count = (
                await session.execute(select(func.count()).select_from(RolePermission))
            ).scalar_one()
        return role_count, permission_count, role_permission_count

    before = await _counts()

    result = _run_alembic("upgrade", "head")
    assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"

    after = await _counts()

    assert before == after


# --- TC-RBAC-017: second raw insert of Role(name='org_admin', org_id=NULL) -> IntegrityError -


@pytest.mark.asyncio
async def test_duplicate_system_role_name_raises_integrity_error() -> None:  # TC-RBAC-017
    async with AsyncSessionLocal() as session:
        session.add(Role(org_id=None, name="org_admin", is_system_role=True))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


# --- TC-RBAC-018: org_admin's RolePermission row count == total Permission row count ---------


@pytest.mark.asyncio
async def test_org_admin_has_every_permission() -> None:  # TC-RBAC-018
    async with AsyncSessionLocal() as session:
        total_permissions = (
            await session.execute(select(func.count()).select_from(Permission))
        ).scalar_one()

        org_admin_permission_count = (
            await session.execute(
                select(func.count())
                .select_from(RolePermission)
                .join(Role, Role.id == RolePermission.role_id)
                .where(Role.name == "org_admin", Role.org_id.is_(None))
            )
        ).scalar_one()

    assert total_permissions > 0
    assert org_admin_permission_count == total_permissions


# --- TC-RBAC-019: `alembic downgrade -1` removes the 5 system Role rows (+ cascaded ----------
# --- RolePermission rows), Permission catalog rows remain; re-`upgrade head` after -----------
# --- to leave the DB seeded for anyone else. Runs last (file order = execution order, no ----
# --- randomization plugin installed) since it destructively mutates seed state. -------------


@pytest.mark.asyncio
async def test_migration_downgrade_removes_only_the_five_system_roles() -> None:  # TC-RBAC-019
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Role.id, Role.name).where(Role.org_id.is_(None)))
        system_role_ids = {row[0] for row in result.all()}
        assert len(system_role_ids) == 5  # sanity precondition, matches TC-RBAC-012

        permission_count_before = (
            await session.execute(select(func.count()).select_from(Permission))
        ).scalar_one()

    try:
        # Target the seed migration's own `down_revision` explicitly, not a
        # relative `-1` step: RBAC-3 added two migrations on top of the seed
        # migration (`34053c46f9fc`) as the Alembic chain grew, so `-1` from
        # head no longer lands on the seed migration's own revert — it only
        # undoes whatever the newest migration happens to be. `d33d66f4b3c3`
        # is `34053c46f9fc`'s `down_revision`, i.e. "downgrade past the seed
        # migration itself, however many migrations now sit on top of it."
        downgrade_result = _run_alembic("downgrade", "d33d66f4b3c3")
        assert downgrade_result.returncode == 0, (
            f"alembic downgrade to d33d66f4b3c3 failed:\n{downgrade_result.stdout}\n{downgrade_result.stderr}"
        )

        async with AsyncSessionLocal() as session:
            remaining_system_roles = (
                await session.execute(select(func.count()).select_from(Role).where(Role.org_id.is_(None)))
            ).scalar_one()
            assert remaining_system_roles == 0

            remaining_role_permissions = (
                await session.execute(
                    select(func.count())
                    .select_from(RolePermission)
                    .where(RolePermission.role_id.in_(system_role_ids))
                )
            ).scalar_one()
            assert remaining_role_permissions == 0

            permission_count_after_downgrade = (
                await session.execute(select(func.count()).select_from(Permission))
            ).scalar_one()
            assert permission_count_after_downgrade == permission_count_before
    finally:
        # Always re-seed, even if an assertion above failed, so this test
        # doesn't leave the shared isolated DB unseeded for anyone/anything
        # that runs after it.
        reupgrade_result = _run_alembic("upgrade", "head")
        assert reupgrade_result.returncode == 0, (
            f"alembic upgrade head (re-seed) failed:\n{reupgrade_result.stdout}\n{reupgrade_result.stderr}"
        )

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Role.name).where(Role.org_id.is_(None)))
        names = {row[0] for row in result.all()}
    assert names == set(SYSTEM_ROLE_NAMES)


# --- App-startup sanity: the health endpoint the whole suite's skip-guard already probed -----
# --- (belt-and-braces re-assertion here, scoped explicitly to this file's own concern: -------
# --- proving the RBAC-4 schema change alone didn't break app boot). -------------------------


@pytest.mark.asyncio
async def test_live_server_health_check_still_ok_after_rbac_seed_migration() -> None:
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
