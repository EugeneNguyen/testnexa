"""Skip-guard for the integration suite.

Unlike `tests/unit`, these tests hit a *live* HTTP server (see
`test_health_api.py`), which may not be running during a plain `pytest`
invocation (e.g. CI steps that only start the app later, or a developer
running the whole suite without `docker compose` up). Rather than let every
test in this module fail with a confusing connection error, this fixture
probes the target server once per session and skips the entire module
cleanly if it isn't reachable.
"""

import os

import httpx
import pytest

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")

# Short timeout: this is a local/CI reachability probe, not a real request.
_PROBE_TIMEOUT_SECONDS = 2.0


@pytest.fixture(scope="session", autouse=True)
def _require_live_server() -> None:
    """Skip the whole integration module if the target server isn't up."""
    try:
        response = httpx.get(
            f"{TEST_API_BASE_URL}/health",
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except (httpx.HTTPError, OSError) as exc:
        pytest.skip(
            f"Integration suite requires a live server at {TEST_API_BASE_URL} "
            f"(set via TEST_API_BASE_URL); it is not reachable: {exc}. "
            "Bring the stack up first, e.g. `docker compose --profile dev up`.",
            allow_module_level=True,
        )
