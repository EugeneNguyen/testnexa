"""Unit tests for `app/core/rbac.py`'s `get_current_actor` (AUTH-2, Task 1).

Pure in-process tests: no DB, no live server (except
`test_401_response_body_is_flat_not_nested_under_detail`, which spins up an
in-process `TestClient` — still no real network/DB, `httpx`'s ASGI transport
never leaves the process). Mirrors the style of `tests/unit/test_security.py`.
`get_current_actor` is a FastAPI dependency that needs an `AsyncSession` to
look up `User` by the token's `sub` claim — since this repo's `CLAUDE.md`
forbids a live DB/network in unit tests and no existing unit test establishes
a DB-mocking convention yet, these tests use a minimal hand-rolled fake
session (`_FakeSession`) whose `execute()` returns a fake `Result` wired to
return a preset `User | None` from `.scalars().first()` — the only method
`get_current_actor` calls on the session. This keeps the fake to exactly the
surface under test rather than pulling in a generic SQLAlchemy-mocking
library for one call site.

`require_permission`/`has_permission`/`require_human_actor` stay
`NotImplementedError` per this task's scope — not covered here.
"""

import uuid

import jwt
import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.rbac import get_current_actor
from app.core.security import create_access_token
from app.main import http_exception_handler
from app.models.actor import User


class _FakeScalars:
    def __init__(self, user: User | None) -> None:
        self._user = user

    def first(self) -> User | None:
        return self._user


class _FakeResult:
    def __init__(self, user: User | None) -> None:
        self._user = user

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._user)


class _FakeSession:
    """Stands in for `AsyncSession`; only `execute()` is exercised."""

    def __init__(self, user: User | None) -> None:
        self._user = user
        self.executed = False

    async def execute(self, _stmt: object) -> _FakeResult:
        self.executed = True
        return _FakeResult(self._user)


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _make_user(actor_id: uuid.UUID) -> User:
    return User(
        actor_id=actor_id,
        name="Test User",
        email="test-user@example.com",
        password_hash="$argon2$irrelevant$",
    )


# --- valid token ------------------------------------------------------------


async def test_valid_token_resolves_the_correct_actor() -> None:
    actor_id = uuid.uuid4()
    user = _make_user(actor_id)
    token = create_access_token(str(actor_id))
    session = _FakeSession(user)

    resolved = await get_current_actor(credentials=_bearer(token), db=session)

    assert resolved is user
    assert session.executed is True


# --- expired token ------------------------------------------------------------


async def test_expired_token_raises_401() -> None:
    actor_id = uuid.uuid4()
    token = create_access_token(str(actor_id), expires_minutes=-1)
    session = _FakeSession(_make_user(actor_id))

    with pytest.raises(HTTPException) as exc_info:
        await get_current_actor(credentials=_bearer(token), db=session)

    assert exc_info.value.status_code == 401


# --- tampered / invalid signature ------------------------------------------------------------


async def test_tampered_signature_raises_401() -> None:
    import time

    actor_id = uuid.uuid4()
    now = time.time()
    claims = {
        "sub": str(actor_id),
        "iat": now,
        "exp": now + 900,
        "type": "access",
    }
    bogus_token = jwt.encode(claims, "definitely-not-the-real-secret", algorithm="HS256")
    assert settings.JWT_SECRET != "definitely-not-the-real-secret"
    session = _FakeSession(_make_user(actor_id))

    with pytest.raises(HTTPException) as exc_info:
        await get_current_actor(credentials=_bearer(bogus_token), db=session)

    assert exc_info.value.status_code == 401


# --- well-formed valid token, no matching User row ------------------------------------------------------------


async def test_sub_with_no_matching_user_raises_401() -> None:
    actor_id = uuid.uuid4()
    token = create_access_token(str(actor_id))
    session = _FakeSession(None)  # no row found

    with pytest.raises(HTTPException) as exc_info:
        await get_current_actor(credentials=_bearer(token), db=session)

    assert exc_info.value.status_code == 401
    assert session.executed is True


# --- missing credentials ------------------------------------------------------------


async def test_missing_credentials_raises_401() -> None:
    session = _FakeSession(None)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_actor(credentials=None, db=session)

    assert exc_info.value.status_code == 401
    assert session.executed is False


# --- 401 error shape on the wire ------------------------------------------------------------
#
# Fix round 1 (Critical finding): the previous version of this test
# (`test_401_error_body_matches_api_error_shape`) only asserted against
# `exc_info.value.detail` — the Python-level `HTTPException.detail` dict —
# which is NOT what FastAPI serializes onto the wire by default (it nests it
# one level deeper as `{"detail": {...}}`). That made the test's own name a
# false promise: it could not have caught the missing-global-handler bug.
# Replaced with a real `TestClient` hitting a real ASGI app wired with the
# actual `app.main.http_exception_handler` and the actual `get_current_actor`
# dependency, asserting the literal JSON response body FastAPI/Starlette
# produce for a 401 raised inside a dependency.


def _build_protected_test_app() -> FastAPI:
    """Throwaway FastAPI app, not `app.main.app` itself.

    Registers the real `http_exception_handler` (imported from `app.main`,
    not reimplemented here) plus one throwaway route depending on the real
    `get_current_actor`. A standalone app rather than mounting onto the
    shared `app.main.app`/`app.api.routes.auth` router: this task does not
    own `routes/auth.py` (Task 2's `GET /auth/me` will be the real route
    exercising this exact path against the real app), and a shared global
    `app` singleton shouldn't gain a test-only route as a side effect of
    running this test suite.
    """
    test_app = FastAPI()
    test_app.add_exception_handler(HTTPException, http_exception_handler)

    @test_app.get("/__protected")
    async def _protected(actor: User = Depends(get_current_actor)) -> dict[str, str]:
        return {"actor_id": str(actor.actor_id)}

    return test_app


def test_401_response_body_is_flat_not_nested_under_detail() -> None:
    """API Document §1 / NFR-8: every non-2xx response body is the flat
    `{"code", "message", "field_errors"}` shape — never FastAPI's default
    `{"detail": {...}}` nesting. Calling with no `Authorization` header hits
    `get_current_actor`'s `credentials is None` 401 path.
    """
    client = TestClient(_build_protected_test_app())

    response = client.get("/__protected")

    assert response.status_code == 401
    body = response.json()
    assert "detail" not in body
    assert set(body.keys()) == {"code", "message", "field_errors"}
    assert body["field_errors"] is None
    assert isinstance(body["code"], str)
    assert isinstance(body["message"], str)
