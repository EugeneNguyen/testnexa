"""Unit tests for `app/core/security.py` — password hashing, JWT issuance/
verification, refresh-token generation/hashing, and (AUTH-4/ADR-0015)
AIAgent API-key generation/hashing/verification.

Pure in-process tests: no DB, no live server. Mirrors the style of
`tests/unit/test_health.py` / `tests/unit/test_models_import.py`.
"""

import time

import jwt
import pytest

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_api_key,
    hash_api_key,
    hash_password,
    hash_refresh_token,
    verify_api_key,
    verify_password,
    verify_password_or_dummy,
)

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


# --- generate_api_key / hash_api_key / verify_api_key (AUTH-4/ADR-0015) --------------------
#
# Raw key format: `tnx_agent_<key_prefix(8 url-safe chars)>_<secret(43 url-safe
# chars, secrets.token_urlsafe(32))>`. See `generate_api_key`'s own docstring
# (app/core/security.py) for the exact character-count math.

_URL_SAFE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def test_generate_api_key_raw_key_starts_with_literal_prefix() -> None:
    raw_key, _key_prefix = generate_api_key()
    assert raw_key.startswith("tnx_agent_")


def test_generate_api_key_key_prefix_is_eight_url_safe_chars() -> None:
    _raw_key, key_prefix = generate_api_key()
    assert len(key_prefix) == 8
    assert set(key_prefix) <= _URL_SAFE_CHARS


def test_generate_api_key_raw_key_embeds_the_returned_key_prefix() -> None:
    # The raw key's own `tnx_agent_<prefix>_<secret>` shape must be built
    # from the exact same `key_prefix` value returned alongside it — the
    # `get_current_actor` agent branch (app/core/rbac.py) slices the raw key
    # by fixed offsets to recover this same substring, so the two must agree.
    raw_key, key_prefix = generate_api_key()
    assert raw_key.startswith(f"tnx_agent_{key_prefix}_")


def test_generate_api_key_secret_segment_is_43_url_safe_chars() -> None:
    raw_key, key_prefix = generate_api_key()
    secret = raw_key[len(f"tnx_agent_{key_prefix}_") :]
    assert len(secret) == 43
    assert set(secret) <= _URL_SAFE_CHARS


def test_generate_api_key_two_calls_produce_distinct_prefixes() -> None:
    _raw_key_a, key_prefix_a = generate_api_key()
    _raw_key_b, key_prefix_b = generate_api_key()
    assert key_prefix_a != key_prefix_b


def test_generate_api_key_two_calls_produce_distinct_raw_keys() -> None:
    raw_key_a, _key_prefix_a = generate_api_key()
    raw_key_b, _key_prefix_b = generate_api_key()
    assert raw_key_a != raw_key_b


def test_hash_api_key_roundtrip_valid_key_verifies() -> None:
    raw_key, _key_prefix = generate_api_key()
    key_hash = hash_api_key(raw_key)
    assert verify_api_key(raw_key, key_hash) is True


def test_hash_api_key_wrong_key_fails_verify() -> None:
    raw_key, _key_prefix = generate_api_key()
    key_hash = hash_api_key(raw_key)
    other_raw_key, _other_prefix = generate_api_key()
    assert verify_api_key(other_raw_key, key_hash) is False


def test_hash_api_key_has_argon2_prefix() -> None:
    raw_key, _key_prefix = generate_api_key()
    key_hash = hash_api_key(raw_key)
    assert key_hash.startswith("$argon2")


def test_verify_api_key_prefix_matched_but_secret_corrupted_fails() -> None:
    # TC-AUTH-029's mechanism at the unit level: a candidate row's key_hash
    # only ever matches its own exact raw key — a value sharing the same
    # `tnx_agent_<prefix>_` shape but a different secret segment (as if two
    # keys coincidentally shared a key_prefix) must fail the argon2 verify,
    # proving the prefix-narrowed lookup doesn't short-circuit it.
    raw_key, key_prefix = generate_api_key()
    key_hash = hash_api_key(raw_key)
    other_raw_key, other_prefix = generate_api_key()
    # Fixed-offset slice (mirrors get_current_actor's own parsing, app/core/rbac.py) —
    # NOT str.split("_")/rsplit, since the url-safe-base64 secret segment can
    # itself legitimately contain "_" characters.
    other_secret = other_raw_key[len(f"tnx_agent_{other_prefix}_") :]
    crafted_key = f"tnx_agent_{key_prefix}_{other_secret}"
    assert crafted_key != raw_key
    assert verify_api_key(crafted_key, key_hash) is False
