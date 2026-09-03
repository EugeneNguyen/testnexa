"""Password hashing, JWT issuance/verification, and AI-agent API-key handling.

STUB MODULE — function signatures + docstrings only, per ADR-0003
(auth & token strategy). No auth logic is implemented in this scaffold;
implementation is deferred to a later task.
"""

from typing import Any


def hash_password(password: str) -> str:
    """Hash a plaintext human password with argon2 (via passlib).

    Used for `User.password_hash` (Database Document §actor.py).
    """
    raise NotImplementedError("feature work")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored argon2 hash."""
    raise NotImplementedError("feature work")


def create_access_token(actor_id: str, expires_minutes: int | None = None) -> str:
    """Issue a short-lived JWT access token for the given actor.

    TTL defaults to `Settings.JWT_ACCESS_TTL_MINUTES`.
    """
    raise NotImplementedError("feature work")


def create_refresh_token(actor_id: str, expires_days: int | None = None) -> str:
    """Issue a long-lived refresh token (raw value; the DB stores only its hash).

    Backed by the `RefreshToken` table (Database Document §auth.py) so it is
    server-side revocable per ADR-0003.
    """
    raise NotImplementedError("feature work")


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT (access or refresh), returning its claims.

    Must raise on expiry/invalid signature — caller maps that to 401.
    """
    raise NotImplementedError("feature work")


def hash_refresh_token(raw_token: str) -> str:
    """Hash a raw refresh token for storage in `RefreshToken.token_hash`.

    The raw token is never persisted, only its hash.
    """
    raise NotImplementedError("feature work")


def generate_api_key() -> tuple[str, str]:
    """Generate a new opaque AIAgent API key.

    Returns `(raw_key, key_prefix)`. The raw key is shown once at creation
    (GitHub-PAT-style) and never stored; only its argon2 hash
    (`AIAgent.key_hash`) and a display `key_prefix` are persisted.
    """
    raise NotImplementedError("feature work")


def hash_api_key(raw_key: str) -> str:
    """Hash a raw AIAgent API key with argon2 for storage in `AIAgent.key_hash`."""
    raise NotImplementedError("feature work")


def verify_api_key(raw_key: str, key_hash: str) -> bool:
    """Verify a raw AIAgent API key against a stored argon2 hash."""
    raise NotImplementedError("feature work")
