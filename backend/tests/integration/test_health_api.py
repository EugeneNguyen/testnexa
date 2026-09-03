"""Health check API/integration test — exercises a live running server.

Unlike `tests/unit/test_health.py` (in-process `TestClient`, no real
network), this test makes a real HTTP request over the network to a server
that must already be running, proving the process actually binds and serves
on its port. See `conftest.py` for the skip-guard that keeps this module
from failing (as opposed to skipping) when no server is up.
"""

import os

import httpx
import pytest

TEST_API_BASE_URL = os.environ.get("TEST_API_BASE_URL", "http://localhost:8000")


@pytest.mark.asyncio
async def test_health_returns_ok_over_real_http() -> None:
    async with httpx.AsyncClient(base_url=TEST_API_BASE_URL) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
