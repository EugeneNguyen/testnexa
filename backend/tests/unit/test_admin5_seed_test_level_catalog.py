"""Unit tests for ADMIN-5's `TestLevel` seed migration data
(`alembic/versions/63f8478c1c12_seed_test_level_catalog.py`, ADR-0066).

Pure-Python, no DB/network — asserts the shape of the static
`TEST_LEVEL_NAMES` catalog the migration's `upgrade()` inserts. Does NOT
touch the migration's `upgrade()`/`downgrade()` functions themselves or a
live DB; those (and the actual insert/idempotency/downgrade behavior) are
covered by `tests/integration/test_admin5_seed_test_level.py` instead —
same "pure-Python catalog shape here, real DB behavior there" split
`test_rbac_seed_catalog.py`/`test_rbac_seed.py` already established for
RBAC-4's own seed.

The migration file is loaded via `importlib` (not a normal `import`) since
alembic revision filenames aren't valid Python module identifiers — the same
technique alembic's own tooling uses internally.
"""

import importlib.util
from pathlib import Path

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "63f8478c1c12_seed_test_level_catalog.py"
)
_spec = importlib.util.spec_from_file_location("admin5_seed_migration_unit", _MIGRATION_PATH)
_seed_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_seed_migration)

EXPECTED_ISTQB_TEST_LEVELS = [
    "Component Testing",
    "Component Integration Testing",
    "System Testing",
    "System Integration Testing",
    "Acceptance Testing",
]


def test_catalog_has_exactly_the_five_named_istqb_test_levels() -> None:
    assert _seed_migration.TEST_LEVEL_NAMES == EXPECTED_ISTQB_TEST_LEVELS


def test_catalog_names_are_unique() -> None:
    names = _seed_migration.TEST_LEVEL_NAMES
    assert len(names) == len(set(names))


def test_catalog_has_no_blank_or_whitespace_only_names() -> None:
    for name in _seed_migration.TEST_LEVEL_NAMES:
        assert name == name.strip()
        assert len(name) > 0


def test_revision_chain_points_at_the_current_head_when_written() -> None:
    # Documents the chain this migration was written against — a genuine
    # collision (a later migration also claiming `f19a7c3e5b62` as its own
    # `down_revision`) is an Alembic multi-head error at `alembic upgrade
    # head` time, not something this unit test can detect on its own; this
    # assertion just pins the intended value for a quick static read.
    assert _seed_migration.down_revision == "f19a7c3e5b62"
    assert _seed_migration.revision == "63f8478c1c12"
