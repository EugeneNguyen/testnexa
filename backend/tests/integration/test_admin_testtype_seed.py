"""Integration tests for the TestType catalog seed migration
(`854917c76ac5_seed_test_type_catalog`, ADR-0067 — drafted as ADR-0066,
renumbered at merge time after ADMIN-5 independently claimed that number for
the sibling `TestLevel` catalog).

Covers TC-ADMIN-043 (`docs/test-cases/2026-09-03-test-cases.md`, Test Design
§55): seed presence, re-apply idempotency, and admin-added custom-row
survival across both a re-apply and a `downgrade()`. Same shape as
`test_rbac_seed.py`'s own TC-RBAC-016/019 migration-mechanics tests and
`test_admin5_seed_test_level.py`'s own TC-ADMIN-041/042 — direct
`AsyncSessionLocal` assertions plus shelling out to the real `alembic` CLI
against `DATABASE_URL`, not a re-implementation of the migration's own logic
in Python.

**Idempotency is asserted via direct `upgrade()` invocation, not a second
CLI `upgrade head` call** — confirmed live (ADMIN-5's own retro,
`backend/CLAUDE.md`) that a CLI re-invocation when the DB is already at that
revision is a pure bookkeeping no-op and never re-enters the migration
file's `upgrade()` body at all, which would make the assertion pass
regardless of whether the migration's own existence-check logic works. See
`_run_upgrade_twice` below, same technique `test_admin5_seed_test_level.py`
already established for the sibling `TestLevel` migration.

The package-level `tests/integration/conftest.py` fixture still applies —
it probes `{TEST_API_BASE_URL}/health` and skips the whole suite if
unreachable. `TestType` has no bespoke REST route of its own beyond the
generic factory's already-tested `GET /entities/test-types/schema` (ADMIN-3),
so this file is DB-level, same posture `test_rbac_seed.py` documents for
RBAC-4.
"""

import importlib.util
import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.db.session import engine as app_engine
from app.models.assets import TestCase
from app.models.taxonomy import TestType

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")
BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/tests/integration/../.. -> backend/

SEED_NAMES = [
    "Functional Testing",
    "Non-functional Testing",
    "Black-box Testing",
    "White-box Testing",
    "Confirmation Testing",
]

# This migration's own `down_revision` — the absolute target for downgrade
# tests, not a relative `-1`, per `test_rbac_seed.py`'s own documented reason
# (a relative offset stops meaning "undo this migration" the moment anything
# stacks on top of it). Re-pointed to ADMIN-5's `63f8478c1c12` after the
# merge-time Alembic-chain reconciliation (see the migration file's own
# docstring).
MIGRATION_REVISION = "854917c76ac5"
DOWN_REVISION = "63f8478c1c12"


def _load_migration_module():
    migration_path = BACKEND_DIR / "alembic" / "versions" / "854917c76ac5_seed_test_type_catalog.py"
    assert migration_path.exists(), migration_path
    spec = importlib.util.spec_from_file_location("_testtype_seed_migration_live", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["alembic", *args],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
    )


async def _seeded_names() -> list[str]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TestType.name).where(TestType.name.in_(SEED_NAMES))
        )
        return sorted(row[0] for row in result.all())


@pytest.mark.asyncio
async def test_seed_presence_exactly_five_rows() -> None:  # TC-ADMIN-043 (positive)
    assert await _seeded_names() == sorted(SEED_NAMES)


@pytest.mark.asyncio
async def test_migration_upgrade_is_idempotent() -> None:  # TC-ADMIN-043 (idempotency)
    migration = _load_migration_module()

    async def _count() -> int:
        async with AsyncSessionLocal() as session:
            return (
                await session.execute(
                    select(func.count())
                    .select_from(TestType)
                    .where(TestType.name.in_(SEED_NAMES))
                )
            ).scalar_one()

    before = await _count()
    assert before == 5

    def _run_upgrade_twice(sync_conn) -> None:
        from alembic.operations import Operations
        from alembic.runtime.migration import MigrationContext

        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            migration.upgrade()
            migration.upgrade()

    async with app_engine.connect() as conn:
        await conn.run_sync(_run_upgrade_twice)
        await conn.commit()

    after = await _count()
    assert after == before == 5


@pytest.mark.asyncio
async def test_custom_row_survives_reapply_and_downgrade() -> None:  # TC-ADMIN-043 (custom-row survival)
    custom_name = f"Custom Regression Suite {uuid.uuid4().hex[:8]}"

    async with AsyncSessionLocal() as session:
        session.add(TestType(id=uuid.uuid4(), name=custom_name))
        await session.commit()

    try:
        # Re-apply: the custom row must be untouched, the 5 seeded names
        # must still be exactly present (no duplicate insert triggered by
        # the custom row's unrelated name).
        result = _run_alembic("upgrade", "head")
        assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"

        async with AsyncSessionLocal() as session:
            custom_still_present = (
                await session.execute(select(TestType).where(TestType.name == custom_name))
            ).scalar_one_or_none()
            assert custom_still_present is not None

            seeded_count = (
                await session.execute(
                    select(func.count())
                    .select_from(TestType)
                    .where(TestType.name.in_(SEED_NAMES))
                )
            ).scalar_one()
            assert seeded_count == 5

        # Downgrade: only the 5 seeded rows are deleted, by name — the
        # custom row survives. A real revision transition (unlike the
        # same-revision idempotency test above) genuinely executes the
        # migration's own `downgrade()` body — confirmed via ADMIN-5's own
        # documented distinction. Same FK-safety posture as
        # `test_rbac_seed.py`'s TC-RBAC-019: if any real `TestCase` in this
        # DB happens to reference one of the 5 seeded rows by id (a RESTRICT
        # FK), the downgrade would correctly fail rather than exercise this
        # test's intended clean-downgrade path — skip cleanly rather than
        # let an unrelated environment precondition masquerade as a
        # regression here.
        async with AsyncSessionLocal() as session:
            seeded_ids = {
                row[0]
                for row in (
                    await session.execute(
                        select(TestType.id).where(TestType.name.in_(SEED_NAMES))
                    )
                ).all()
            }
            referencing_test_cases = (
                await session.execute(
                    select(func.count())
                    .select_from(TestCase)
                    .where(TestCase.test_type_id.in_(seeded_ids))
                )
            ).scalar_one()
            if referencing_test_cases > 0:
                pytest.skip(
                    "DB has real TestCase rows referencing one of the 5 seeded TestType "
                    "rows (e.g. cloned from a live/long-lived environment) — `alembic "
                    "downgrade` would correctly fail its test_case_test_type_id_fkey FK, "
                    "not exercise this test's intended clean-downgrade path."
                )

        downgrade_result = _run_alembic("downgrade", DOWN_REVISION)
        assert downgrade_result.returncode == 0, (
            f"alembic downgrade failed:\n{downgrade_result.stdout}\n{downgrade_result.stderr}"
        )

        async with AsyncSessionLocal() as session:
            seeded_count_after_downgrade = (
                await session.execute(
                    select(func.count())
                    .select_from(TestType)
                    .where(TestType.name.in_(SEED_NAMES))
                )
            ).scalar_one()
            assert seeded_count_after_downgrade == 0

            custom_still_present_after_downgrade = (
                await session.execute(select(TestType).where(TestType.name == custom_name))
            ).scalar_one_or_none()
            assert custom_still_present_after_downgrade is not None
    finally:
        # Leave the DB seeded for anything that runs after this test
        # (same "restore state" discipline `test_rbac_seed.py`'s TC-RBAC-019
        # follows), and clean up the custom row this test itself created.
        upgrade_back = _run_alembic("upgrade", "head")
        assert upgrade_back.returncode == 0, (
            f"alembic upgrade head (restore) failed:\n{upgrade_back.stdout}\n{upgrade_back.stderr}"
        )
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(select(TestType).where(TestType.name == custom_name))
            ).scalar_one_or_none()
            if row is not None:
                await session.delete(row)
                await session.commit()
