"""Password hashing, JWT issuance/verification, and AI-agent API-key handling.

AUTH-1 implements the human-login half of this module per ADR-0003 (auth &
token strategy): argon2 password hashing, JWT access-token issuance/
verification, and opaque refresh-token issuance/hashing. AUTH-4 (ADR-0015)
adds the other half: the `generate_api_key`/`hash_api_key`/`verify_api_key`
trio backing `AIAgent` bearer credentials.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings

# Argon2id via passlib, with explicit cost params rather than library
# defaults (NFR-3, AUTH-1 scope plan edge case "Argon2 parameters"). These
# sit inside OWASP's Argon2 cheat-sheet guidance for an interactive login
# path: time_cost=3, memory_cost=65536 KiB (64 MiB), parallelism=4. AIAgent
# API-key hashing (AUTH-4, out of scope) is off the request-latency-sensitive
# login path and may justify a different cost trade-off when implemented.
_pwd_context = CryptContext(
    schemes=["argon2"],
    argon2__time_cost=3,
    argon2__memory_cost=65536,
    argon2__parallelism=4,
)

# Fixed dummy hash used by `verify_password_or_dummy` so a login attempt
# against a nonexistent email (or a user with no `provider=local`
# AuthIdentity) still pays the same argon2-verify cost as a real one — closes
# the timing side-channel that would otherwise let an attacker distinguish
# "no such user" from "wrong password" (AUTH-1 acceptance criteria, Test
# Design §2, scope plan edge case "User-enumeration timing leak"). Computed
# once at import time, not per-request.
_DUMMY_PASSWORD_HASH = _pwd_context.hash("dummy-password-for-timing-safety")


def hash_password(password: str) -> str:
    """Hash a plaintext human password with argon2 (via passlib).

    Used for `User.password_hash` (Database Document §actor.py).
    """
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored argon2 hash."""
    return _pwd_context.verify(password, password_hash)


def verify_password_or_dummy(password: str, password_hash: str | None) -> bool:
    """Timing-safe password check for the login route.

    Always runs an argon2 verify, even when `password_hash` is `None` (email
    not found, or the `User` has no `provider=local` `AuthIdentity`) — in
    that case it verifies against a fixed dummy hash instead of short-
    circuiting. Without this, "no such user" would return measurably faster
    than "wrong password", letting an attacker enumerate valid emails by
    response timing alone. Always returns `False` when `password_hash` is
    `None`, regardless of the dummy-hash verify's own (meaningless) result.
    """
    if password_hash is None:
        _pwd_context.verify(password, _DUMMY_PASSWORD_HASH)
        return False
    return _pwd_context.verify(password, password_hash)


def create_access_token(actor_id: str, expires_minutes: int | None = None) -> str:
    """Issue a short-lived JWT access token for the given actor.

    TTL defaults to `Settings.JWT_ACCESS_TTL_MINUTES`. Claims: `sub` (actor
    id), `iat`, `exp`, and `type: "access"` (distinguishes this from any
    future JWT-shaped token type; refresh tokens themselves are opaque, see
    `create_refresh_token`).
    """
    ttl_minutes = expires_minutes if expires_minutes is not None else settings.JWT_ACCESS_TTL_MINUTES
    now = datetime.now(UTC)
    claims: dict[str, Any] = {
        "sub": str(actor_id),
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
        "type": "access",
    }
    return jwt.encode(claims, settings.JWT_SECRET, algorithm="HS256")


def create_refresh_token(actor_id: str, expires_days: int | None = None) -> str:
    """Issue a long-lived refresh token (raw value; the DB stores only its hash).

    Backed by the `RefreshToken` table (Database Document §auth.py) so it is
    server-side revocable per ADR-0003. Unlike the access token this is an
    opaque, high-entropy random string (`secrets.token_urlsafe`), NOT a JWT —
    it carries no embedded claims, so it can't be decoded/inspected, only
    looked up by its hash. `actor_id`/`expires_days` are accepted to match
    this module's stub-defined signature and are used by the caller (the
    login route) to populate the corresponding `RefreshToken` row's
    `user_id`/`expires_at` columns — the token string itself does not encode
    either.
    """
    del actor_id, expires_days  # not encoded in the opaque token itself; see docstring
    return secrets.token_urlsafe(32)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT access token, returning its claims.

    Raises `jwt.PyJWTError` (e.g. `jwt.ExpiredSignatureError`,
    `jwt.InvalidSignatureError`) on expiry/invalid signature — the caller
    maps that to a `401`. Only access tokens are JWTs in this scaffold;
    refresh tokens are opaque and are never passed to this function.
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


def hash_refresh_token(raw_token: str) -> str:
    """Hash a raw refresh token for storage in `RefreshToken.token_hash`.

    SHA-256 hex digest, not argon2: the raw token is already a high-entropy
    (256-bit) random value from `secrets.token_urlsafe`, not a low-entropy
    human password guessable via brute force — a fast cryptographic hash is
    sufficient to prevent recovering the raw token from a leaked hash, and
    running the deliberately-slow argon2 KDF here would just be needless CPU
    cost on every refresh (AUTH-1 scope plan edge case "Refresh token
    storage"). The raw token is never persisted, only this hash.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Generate a new opaque AIAgent API key.

    Returns `(raw_key, key_prefix)`. Raw key format (ADR-0015):
    `tnx_agent_<key_prefix>_<secret>` where:
    - `tnx_agent_` is a fixed literal prefix so `get_current_actor`
      (`app/core/rbac.py`) can cheaply discriminate an agent key from a human
      JWT via a `startswith` check, without a decode-and-catch attempt first.
    - `key_prefix` is 8 URL-safe characters — `secrets.token_urlsafe(6)`.
      6 random bytes base64url-encode to exactly 8 characters with no
      padding to strip (6 is a multiple of 3), so the length is exact, not
      just "approximately 8". Stored in `AIAgent.key_prefix` and doubles as
      a lookup-narrowing index (see module docstring / ADR-0015): argon2
      hashes are salted and non-deterministic, so `AIAgent.key_hash` can't
      be looked up by equality — the presented key's prefix narrows a
      `SELECT` to (in practice) zero or one candidate row before paying the
      argon2-verify cost, instead of scanning/verifying every active agent.
    - `secret` is 43 URL-safe characters — `secrets.token_urlsafe(32)` (32
      random bytes, the same entropy budget `create_refresh_token` uses for
      human refresh tokens).

    The raw key is shown once at creation (GitHub-PAT-style) and never
    stored; only its argon2 hash (`AIAgent.key_hash`, via `hash_api_key`) and
    the plaintext `key_prefix` are persisted. Callers must never log the
    returned `raw_key` (same discipline as AUTH-1's plaintext-password rule).
    """
    key_prefix = secrets.token_urlsafe(6)
    secret = secrets.token_urlsafe(32)
    raw_key = f"tnx_agent_{key_prefix}_{secret}"
    return raw_key, key_prefix


def hash_api_key(raw_key: str) -> str:
    """Hash a raw AIAgent API key with argon2 for storage in `AIAgent.key_hash`.

    Reuses the same `_pwd_context` (and cost params) as human password
    hashing — the raw key is high-entropy like a refresh token, but ADR-0003
    explicitly calls for "argon2-hashed at rest" for agent credentials too
    (unlike `hash_refresh_token`, which deliberately uses a fast SHA-256
    digest instead — see that function's docstring for why refresh tokens
    are the one exception).
    """
    return _pwd_context.hash(raw_key)


def verify_api_key(raw_key: str, key_hash: str) -> bool:
    """Verify a raw AIAgent API key against a stored argon2 hash.

    Called once per `key_prefix`-narrowed candidate row in
    `get_current_actor`'s agent branch — see that function for the
    iterate-until-match loop this feeds (prefix collisions are possible,
    if astronomically unlikely, so lookup-by-prefix must not assume
    uniqueness).
    """
    return _pwd_context.verify(raw_key, key_hash)
