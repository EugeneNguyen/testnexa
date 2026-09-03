"""Unit tests for `app/core/security.py` — password hashing, JWT issuance/
verification, refresh-token generation/hashing.

Pure in-process tests: no DB, no live server. Mirrors the style of
`tests/unit/test_health.py` / `tests/unit/test_models_import.py`.
"""

import time

import jwt
import pytest

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
    verify_password_or_dummy,
)
from app.core.config import settings


# --- hash_password / verify_password -----------------------------------------------------


def test_hash_password_roundtrip_correct_password_verifies() -> None:
    password = "correct horse battery staple"
    password_hash = hash_password(password)
    assert verify_password(password, password_hash) is True


def test_hash_password_roundtrip_wrong_password_fails() -> None:
    password_hash = hash_password("correct horse battery staple")
    assert verify_password("wrong password", password_hash) is False


def test_hash_password_has_argon2_prefix() -> None:
    password_hash = hash_password("some-password")
    assert password_hash.startswith("$argon2")


# --- verify_password_or_dummy --------------------------------------------------------------


def test_verify_password_or_dummy_real_hash_correct_password() -> None:
    password = "correct-password-123"
    password_hash = hash_password(password)
    assert verify_password_or_dummy(password, password_hash) is True


def test_verify_password_or_dummy_real_hash_wrong_password() -> None:
    password_hash = hash_password("correct-password-123")
    assert verify_password_or_dummy("wrong-password", password_hash) is False


def test_verify_password_or_dummy_none_hash_always_false() -> None:
    # No password_hash (nonexistent user / no local AuthIdentity) — must
    # always return False, whatever the supplied password is, and must not
    # raise (this is the timing-safe dummy-hash path).
    assert verify_password_or_dummy("anything", None) is False
    assert verify_password_or_dummy("", None) is False
    assert verify_password_or_dummy("correct-password-123", None) is False


def test_verify_password_or_dummy_none_hash_does_not_raise() -> None:
    try:
        verify_password_or_dummy("some-password", None)
    except Exception as exc:  # noqa: BLE001 - explicitly asserting no raise at all
        pytest.fail(f"verify_password_or_dummy raised unexpectedly: {exc!r}")


# --- create_access_token / decode_token ----------------------------------------------------


def test_access_token_roundtrip_returns_same_sub() -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    token = create_access_token(actor_id)
    claims = decode_token(token)
    assert claims["sub"] == actor_id


def test_access_token_claims_include_exp_iat_and_type() -> None:
    token = create_access_token("actor-id-123")
    claims = decode_token(token)
    assert "exp" in claims
    assert "iat" in claims
    assert claims["type"] == "access"


def test_access_token_expired_raises_on_decode() -> None:
    token = create_access_token("actor-id-123", expires_minutes=-1)
    with pytest.raises(jwt.PyJWTError):
        decode_token(token)


def test_access_token_wrong_secret_raises_on_decode() -> None:
    # Construct a token directly, signed with a bogus secret rather than
    # settings.JWT_SECRET, to confirm decode_token rejects a bad signature.
    now = time.time()
    claims = {
        "sub": "actor-id-123",
        "iat": now,
        "exp": now + 900,
        "type": "access",
    }
    bogus_token = jwt.encode(claims, "definitely-not-the-real-secret", algorithm="HS256")
    assert settings.JWT_SECRET != "definitely-not-the-real-secret"
    with pytest.raises(jwt.PyJWTError):
        decode_token(bogus_token)


# --- create_refresh_token --------------------------------------------------------------------


def test_create_refresh_token_has_reasonable_length() -> None:
    token = create_refresh_token("actor-id-123")
    assert isinstance(token, str)
    assert len(token) > 20


def test_create_refresh_token_two_calls_differ() -> None:
    token_a = create_refresh_token("actor-id-123")
    token_b = create_refresh_token("actor-id-123")
    assert token_a != token_b


# --- hash_refresh_token -----------------------------------------------------------------------


def test_hash_refresh_token_is_deterministic() -> None:
    raw_token = "some-raw-refresh-token-value"
    assert hash_refresh_token(raw_token) == hash_refresh_token(raw_token)


def test_hash_refresh_token_different_inputs_differ() -> None:
    assert hash_refresh_token("token-a") != hash_refresh_token("token-b")


def test_hash_refresh_token_looks_like_sha256_hex_digest() -> None:
    digest = hash_refresh_token("some-raw-refresh-token-value")
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)
