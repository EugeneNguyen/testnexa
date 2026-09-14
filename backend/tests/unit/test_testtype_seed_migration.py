"""Unit coverage for the TestType catalog seed migration (TC-ADMIN-043, ADR-0067).

No DB/network — loads the Alembic migration module directly (same
`importlib.util.spec_from_file_location` pattern `test_rbac_seed_catalog.py`
already established for `e5b21d7c8f40_...py`/`d33d66f4b3c3_...py`) and asserts
its own `SEED_NAMES` constant, structurally, rather than re-deriving the list.
The actual DB-level idempotency/custom-row-survival behavior needs a live
Postgres and is covered separately by
`tests/integration/test_admin_testtype_seed.py`.
"""

import importlib.util
from pathlib import Path


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "854917c76ac5_seed_test_type_catalog.py"
    )
    assert migration_path.exists(), migration_path
    spec = importlib.util.spec_from_file_location("_testtype_seed_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_seed_names_match_adr_0067_exactly() -> None:
    module = _load_migration_module()
    assert module.SEED_NAMES == [
        "Functional Testing",
        "Non-functional Testing",
        "Black-box Testing",
        "White-box Testing",
        "Confirmation Testing",
    ]


def test_seed_names_has_no_duplicates() -> None:
    module = _load_migration_module()
    assert len(module.SEED_NAMES) == len(set(module.SEED_NAMES)) == 5


def test_migration_wiring_chains_onto_admin5s_test_level_seed() -> None:
    module = _load_migration_module()
    assert module.down_revision == "63f8478c1c12"  # ADMIN-5's TestLevel seed migration
    assert module.revision == "854917c76ac5"


def test_upgrade_and_downgrade_are_defined_and_callable() -> None:
    module = _load_migration_module()
    assert callable(module.upgrade)
    assert callable(module.downgrade)
