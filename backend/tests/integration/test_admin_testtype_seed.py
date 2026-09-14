"""Integration tests for the TestType catalog seed migration
(`854917c76ac5_seed_test_type_catalog`, ADR-0066).

Covers TC-ADMIN-040 (`docs/test-cases/2026-09-03-test-cases.md`, Test Design
§54): seed presence, re-apply idempotency, and admin-added custom-row
survival across both a re-apply and a `downgrade()`. Same shape as
`test_rbac_seed.py`'s own TC-RBAC-016/019 migration-mechanics tests — direct
`AsyncSessionLocal` assertions plus shelling out to the real `alembic` CLI
against `DATABASE_URL`, not a re-implementation of the migration's own logic
in Python.

The package-level `tests/integration/conftest.py` fixture still applies —
it probes `{TEST_API_BASE_URL}/health` and skips the whole suite if
unreachable. `TestType` has no bespoke REST route of its own beyond the
generic factory's already-tested `GET /entities/test-types/schema` (ADMIN-3),
so this file is DB-level, same posture `test_rbac_seed.py` documents for
RBAC-4.
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
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
# stacks on top of it).
MIGRATION_REVISION = "854917c76ac5"
DOWN_REVISION = "f19a7c3e5b62"


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
async def test_seed_presence_exactly_five_rows() -> None:  # TC-ADMIN-040 (positive)
    assert await _seeded_names() == sorted(SEED_NAMES)


@pytest.mark.asyncio
async def test_migration_rerun_is_idempotent() -> None:  # TC-ADMIN-040 (idempotency)
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

    result = _run_alembic("upgrade", "head")
    assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"

    after = await _count()
    assert after == before == 5


@pytest.mark.asyncio
async def test_custom_row_survives_reapply_and_downgrade() -> None:  # TC-ADMIN-040 (custom-row survival)
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
        # custom row survives. Same FK-safety posture as
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
