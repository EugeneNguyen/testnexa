"""Unit tests for `app/core/rbac.py`'s `get_current_actor` (AUTH-2, Task 1).

Pure in-process tests: no DB, no live server. Mirrors the style of
`tests/unit/test_security.py`. `get_current_actor` is a FastAPI dependency
that needs an `AsyncSession` to look up `User` by the token's `sub` claim —
since this repo's `CLAUDE.md` forbids a live DB/network in unit tests and no
existing unit test establishes a DB-mocking convention yet, these tests use a
minimal hand-rolled fake session (`_FakeSession`) whose `execute()` returns a
fake `Result` wired to return a preset `User | None` from
`.scalars().first()` — the only method `get_current_actor` calls on the
session. This keeps the fake to exactly the surface under test rather than
pulling in a generic SQLAlchemy-mocking library for one call site.

`require_permission`/`has_permission`/`require_human_actor` stay
`NotImplementedError` per this task's scope — not covered here.
"""

import uuid

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.config import settings
from app.core.rbac import get_current_actor
from app.core.security import create_access_token
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


# --- error shape ------------------------------------------------------------


async def test_401_error_body_matches_api_error_shape() -> None:
    session = _FakeSession(None)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_actor(credentials=None, db=session)

    detail = exc_info.value.detail
    assert set(detail.keys()) == {"code", "message", "field_errors"}
    assert detail["field_errors"] is None
    assert isinstance(detail["code"], str)
    assert isinstance(detail["message"], str)
