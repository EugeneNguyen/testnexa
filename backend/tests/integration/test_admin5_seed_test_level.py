"""Integration tests for ADMIN-5's `TestLevel` seed migration (ADR-0066,
`63f8478c1c12_seed_test_level_catalog`).

Real HTTP requests via `httpx.AsyncClient` against a live server
(`TEST_API_BASE_URL`), matching `test_admin2_crud.py`'s established style,
plus direct DB assertions via `AsyncSessionLocal` for the migration-mechanics
cases, matching `test_rbac_seed.py`'s established style for exactly that
class of test. The package-level `tests/integration/conftest.py` fixture
(`_require_live_server`, autouse=True, session-scoped) applies automatically.

Covers TC-ADMIN-040/041/042 (`docs/test-cases/2026-09-03-test-cases.md`,
Test Design §54). TC-ADMIN-041/042 shell out to the real `alembic` CLI
already installed in this venv (`_run_alembic`, copied from
`test_rbac_seed.py`'s own helper of the same name/shape) against the same
`DATABASE_URL` the live server under test uses — this exercises the real
migration file, not a re-implementation of its logic in Python.
"""

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select

from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.actor import Actor, User
from app.models.assets import TestCase
from app.models.auth import AuthIdentity, AuthProvider
from app.models.rbac import Role, RoleAssignment
from app.models.taxonomy import TestLevel
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
API_PREFIX = "/api/v1"
DEFAULT_PASSWORD = "CorrectHorseBatteryStaple!1"
BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/tests/integration/../.. -> backend/

# Down-revision this migration's own `upgrade()`/`downgrade()` sits between
# (`alembic/versions/63f8478c1c12_seed_test_level_catalog.py`). Targeted
# explicitly (absolute), same posture TC-RBAC-019's own comment establishes:
# a relative `alembic downgrade -1` only means "undo whatever is currently
# head," which stops meaning "undo this seed migration specifically" the
# moment a later migration stacks on top of it.
SEED_MIGRATION_DOWN_REVISION = "f19a7c3e5b62"

SEEDED_TEST_LEVEL_NAMES = {
    "Component Testing",
    "Component Integration Testing",
    "System Testing",
    "System Integration Testing",
    "Acceptance Testing",
}


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    """Shell out to the `alembic` CLI in this venv, against `DATABASE_URL`.

    Copied from `test_rbac_seed.py`'s own helper of the same name/shape.
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )


# --- seeding / cleanup helpers (mirrors test_admin2_crud.py's shapes) --------------------------


def _unique_email(tag: str) -> str:
    return f"admin5-{tag}-{uuid4().hex[:8]}@example.com"


def _unique_slug(tag: str) -> str:
    return f"admin5-{tag}-{uuid4().hex[:8]}"


async def _create_user(session, email: str, password: str = DEFAULT_PASSWORD) -> User:
    user = User(name="ADMIN-5 Test User", email=email, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))
    await session.flush()
    return user


async def _create_org(session, slug_prefix: str) -> Organization:
    org = Organization(name=f"ADMIN-5 Test Org {slug_prefix}", slug=_unique_slug(slug_prefix))
    session.add(org)
    await session.flush()
    return org


async def _create_membership(session, user: User, org: Organization) -> OrgMembership:
    membership = OrgMembership(
        org_id=org.id, user_id=user.actor_id, status=OrgMembershipStatus.active, joined_at=datetime.now(UTC)
    )
    session.add(membership)
    await session.flush()
    return membership


async def _get_role_by_name(session, name: str) -> Role:
    result = await session.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    role = result.scalars().first()
    assert role is not None, f"expected the RBAC-4-seeded {name!r} system Role to already exist"
    return role


async def _create_org_admin(session, tag: str) -> tuple[User, Organization]:
    user = await _create_user(session, _unique_email(tag))
    org = await _create_org(session, tag)
    await _create_membership(session, user, org)
    org_admin_role = await _get_role_by_name(session, "org_admin")
    session.add(RoleAssignment(actor_id=user.actor_id, org_id=org.id, project_id=None, role_id=org_admin_role.id))
    await session.flush()
    return user, org


def _access_token_for(actor_id) -> str:
    return create_access_token(str(actor_id))


async def _cleanup(*, user_ids: list | None = None, org_ids: list | None = None) -> None:
    user_ids = user_ids or []
    org_ids = org_ids or []
    async with AsyncSessionLocal() as session:
        if user_ids:
            await session.execute(delete(RoleAssignment).where(RoleAssignment.actor_id.in_(user_ids)))
            await session.execute(delete(OrgMembership).where(OrgMembership.user_id.in_(user_ids)))
            await session.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(user_ids)))
            await session.execute(delete(User).where(User.actor_id.in_(user_ids)))
            await session.execute(delete(Actor).where(Actor.id.in_(user_ids)))
        if org_ids:
            await session.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        await session.commit()


# --- TC-ADMIN-040: seed migration produces exactly the 5 ISTQB test levels ---------------------


@pytest.mark.asyncio
async def test_seed_produces_exactly_five_istqb_test_levels() -> None:  # TC-ADMIN-040
    user_ids: list = []
    org_ids: list = []
    try:
        async with AsyncSessionLocal() as session:
            admin, org = await _create_org_admin(session, "040")
            await session.commit()
            user_ids = [admin.actor_id]
            org_ids = [org.id]
            admin_token = _access_token_for(admin.actor_id)

        async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
            response = await client.get(
                f"{API_PREFIX}/test-levels",
                params={"page_size": 100},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert response.status_code == 200
            body = response.json()
            names = {item["name"] for item in body["items"]}
            # Exact-set match, not a subset check — a 6th unexpected row
            # would pass a subset assertion but must fail this one.
            assert names == SEEDED_TEST_LEVEL_NAMES
            assert body["total"] == 5
    finally:
        await _cleanup(user_ids=user_ids, org_ids=org_ids)


# --- TC-ADMIN-041: re-running `alembic upgrade head` is idempotent ------------------------------


@pytest.mark.asyncio
async def test_seed_migration_upgrade_is_idempotent() -> None:  # TC-ADMIN-041
    async def _count() -> int:
        async with AsyncSessionLocal() as session:
            return (await session.execute(select(func.count()).select_from(TestLevel))).scalar_one()

    before = await _count()

    result = _run_alembic("upgrade", "head")
    assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"

    after = await _count()
    assert before == after


# --- TC-ADMIN-042: downgrading past the seed migration removes only the 5 seeded rows ----------
# --- Runs last (file order = execution order, no randomization plugin installed) since it -----
# --- destructively mutates seed state, same posture as TC-RBAC-019. ---------------------------


@pytest.mark.asyncio
async def test_downgrade_removes_only_the_seeded_rows() -> None:  # TC-ADMIN-042
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(TestLevel.id, TestLevel.name))
        seeded_rows = {row[1]: row[0] for row in result.all() if row[1] in SEEDED_TEST_LEVEL_NAMES}
        assert len(seeded_rows) == 5  # sanity precondition, matches TC-ADMIN-040

        seeded_ids = set(seeded_rows.values())
        # Same skip-guard philosophy as TC-RBAC-019: `TestCase.test_level_id`
        # is a `not null` FK with no `ON DELETE CASCADE`/`SET NULL` back to
        # `test_level` (Database Document §3.9) — if anything already
        # references one of the 5 seeded rows, `DELETE FROM test_level`
        # correctly raises `ForeignKeyViolationError` rather than silently
        # succeeding. That's correct migration behaviour, not a bug to
        # chase; skip cleanly rather than fail on an environment
        # precondition this test was never designed to run under.
        referencing_count = (
            await session.execute(
                select(func.count()).select_from(TestCase).where(TestCase.test_level_id.in_(seeded_ids))
            )
        ).scalar_one()
        if referencing_count > 0:
            pytest.skip(
                "A TestCase already references one of the 5 seeded TestLevel rows — "
                "`alembic downgrade` past the seed migration would correctly fail its "
                "test_case_test_level_id_fkey FK, not exercise TC-ADMIN-042's intended "
                "clean-downgrade path."
            )

        # An independently-created row, standing in for the existing generic
        # `POST /test-levels` create route (the real path a caller would
        # use) — either way, this row was NOT inserted by the seed migration.
        extra = TestLevel(name=f"ADMIN-5 manual level {uuid4().hex[:8]}")
        session.add(extra)
        await session.commit()
        await session.refresh(extra)
        extra_id = extra.id

    try:
        result = _run_alembic("downgrade", SEED_MIGRATION_DOWN_REVISION)
        assert result.returncode == 0, f"alembic downgrade failed:\n{result.stdout}\n{result.stderr}"

        async with AsyncSessionLocal() as session:
            remaining_names = {row[0] for row in (await session.execute(select(TestLevel.name))).all()}
            # The 5 seeded rows are gone...
            assert remaining_names.isdisjoint(SEEDED_TEST_LEVEL_NAMES)
            # ...but the independently-created row survives untouched.
            survivor = await session.get(TestLevel, extra_id)
            assert survivor is not None
    finally:
        # Restore the seeded state for every other test in this suite (and
        # this file's own TC-ADMIN-040/041, if re-run) that depends on
        # exactly the 5 rows existing.
        restore = _run_alembic("upgrade", "head")
        assert restore.returncode == 0, f"alembic upgrade head (restore) failed:\n{restore.stdout}\n{restore.stderr}"
        async with AsyncSessionLocal() as session:
            await session.execute(delete(TestLevel).where(TestLevel.id == extra_id))
            await session.commit()
