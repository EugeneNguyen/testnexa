"""AUTH-1: local password login route.

Source: API Document §2 (`POST /auth/login` contract), ADR-0003 (auth &
token strategy), ADR-0011 (login rate limiting), AUTH-1 scope plan §1/§6.

Errors are returned as plain `JSONResponse`s with the exact top-level shape
`{"code", "message", "field_errors"}` (API Document §1 error shape) rather
than via `HTTPException` — FastAPI's default `HTTPException` handler wraps
`detail` one level deeper (`{"detail": {...}}`), which would not match the
contract, and this scaffold has no global exception handler yet to unwrap it.

Never logs the plaintext password: the request body's `password` field is
only ever passed into `verify_password_or_dummy` and is not otherwise
referenced, printed, or included in any exception/log call in this module.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    verify_password_or_dummy,
)
from app.models.actor import User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.schemas.auth import LoginRequest, LoginResponse, MeResponse, OrgSummary, RefreshResponse

router = APIRouter()

# ADR-0011 / NFR-11: 5 failed attempts per (client_ip, email) per 15-minute
# sliding window -> 429, until the window clears.
_RATE_LIMIT_WINDOW_MINUTES = 15
_RATE_LIMIT_MAX_ATTEMPTS = 5


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape."""
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": None},
    )


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse | JSONResponse:
    """Authenticate a human user by email+password; issue tokens; resolve org context.

    Order of operations (AUTH-1 scope plan §6 / this task's brief):
    1. Rate-limit check FIRST, before any credentials check.
    2. Look up `User` joined to a `provider=local` `AuthIdentity` by lowercased email.
    3. Timing-safe password verify (real hash if found, dummy hash otherwise —
       always takes the argon2-verify code path either way).
    4. Record a `LoginAttempt` row; 401 (generic body) on failure.
    5. Resolve `active`-status `OrgMembership` rows; 403 if zero.
    6. Issue access token (JWT) + refresh token (opaque, persisted hashed).
    7. Set the refresh token as an httpOnly cookie; return the JSON body
       (access token + org context only — refresh token never in the body).
    """
    email = payload.email.lower()
    client_ip = request.client.host if request.client else "unknown"

    # 1. Rate limit. A request rejected here is never itself recorded as a
    # LoginAttempt — it never reached a credentials check.
    #
    # ADR-0011 / AUTH-1 scope plan: "A successful login clears that pair's
    # counter." Only counting `succeeded=false` rows in the trailing window
    # is not sufficient on its own to implement that — a failure recorded
    # before a later success would still count toward the threshold forever
    # (until it aged out of the 15-minute window), which is not a reset. To
    # actually reset on success, only count failures that happened *after*
    # the most recent success for this (email, client_ip) pair, if any.
    window_start = datetime.now(UTC) - timedelta(minutes=_RATE_LIMIT_WINDOW_MINUTES)
    last_success_at = await db.scalar(
        select(func.max(LoginAttempt.attempted_at)).where(
            LoginAttempt.email == email,
            LoginAttempt.client_ip == client_ip,
            LoginAttempt.succeeded.is_(True),
        )
    )
    effective_window_start = max(window_start, last_success_at) if last_success_at else window_start
    failed_count = await db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            LoginAttempt.email == email,
            LoginAttempt.client_ip == client_ip,
            LoginAttempt.succeeded.is_(False),
            LoginAttempt.attempted_at >= effective_window_start,
        )
    )
    if (failed_count or 0) >= _RATE_LIMIT_MAX_ATTEMPTS:
        return _error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many login attempts. Try again later.",
        )

    # 2. Look up User + local AuthIdentity by lowercased email. A user with
    # no provider=local identity (e.g. OIDC-only, out of scope) yields no
    # row here, same as a nonexistent email — both hit the dummy-hash path.
    result = await db.execute(
        select(User)
        .join(AuthIdentity, AuthIdentity.user_id == User.actor_id)
        .where(User.email == email, AuthIdentity.provider == AuthProvider.local)
    )
    user = result.scalars().first()

    # 3. Timing-safe verify — always runs an argon2 verify, real or dummy.
    password_hash = user.password_hash if user is not None else None
    password_ok = verify_password_or_dummy(payload.password, password_hash)

    # 4. Record attempt; identical 401 body whether the email existed or not.
    if user is None or not password_ok:
        db.add(LoginAttempt(email=email, client_ip=client_ip, succeeded=False))
        await db.commit()
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_credentials",
            "Invalid email or password.",
        )

    db.add(LoginAttempt(email=email, client_ip=client_ip, succeeded=True))

    # 5. Resolve active-only org memberships.
    org_result = await db.execute(
        select(Organization)
        .join(OrgMembership, OrgMembership.org_id == Organization.id)
        .where(
            OrgMembership.user_id == user.actor_id,
            OrgMembership.status == OrgMembershipStatus.active,
        )
    )
    orgs = list(org_result.scalars().all())

    if not orgs:
        await db.commit()
        return _error(
            status.HTTP_403_FORBIDDEN,
            "no_active_organization",
            "Your account has no active organization membership. Contact your administrator.",
        )

    org_context: Literal["auto", "picker"] = "auto" if len(orgs) == 1 else "picker"

    # 6. Issue tokens; persist the refresh token's hash (ADR-0003).
    access_token = create_access_token(str(user.actor_id))
    raw_refresh_token = create_refresh_token(str(user.actor_id))
    now = datetime.now(UTC)
    db.add(
        RefreshToken(
            user_id=user.actor_id,
            token_hash=hash_refresh_token(raw_refresh_token),
            issued_at=now,
            expires_at=now + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        )
    )
    await db.commit()

    # 7. Refresh token: httpOnly cookie only, never in the JSON body.
    # `secure=False` is only acceptable for local dev over plain HTTP.
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
    )

    return LoginResponse(
        access_token=access_token,
        org_context=org_context,
        orgs=[OrgSummary(id=org.id, name=org.name, slug=org.slug) for org in orgs],
    )


@router.post("/auth/refresh", response_model=RefreshResponse)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> RefreshResponse | JSONResponse:
    """Rotate a refresh token; issue a new access token (ADR-0013).

    No request body — the only input is the `refresh_token` httpOnly cookie.
    Errors are returned as plain `JSONResponse`s via `_error()`, same pattern
    as `login()` above, NOT `HTTPException` — this is a route handler with
    its own response object, not a dependency.

    Order of operations (ADR-0013 / API Document §2):
    1. Missing cookie -> 401 `invalid_refresh_token`.
    2. Hash the cookie value; look up `RefreshToken` by `token_hash`.
    3. Not found, or already revoked (includes rotated-out), or expired ->
       401 `invalid_refresh_token` — one generic code for all four causes,
       no distinct per-cause codes (no enumeration of *why* a token is bad).
    4. Re-check active `OrgMembership` for the token's `user_id`; zero active
       -> 403 `no_active_organization`. This is a non-destructive rejection:
       the presented refresh token is NOT revoked here, only this attempt
       fails — a later refresh can still succeed if membership is
       reactivated before the token's `expires_at`.
    5. Rotate: revoke the presented row (`revoked_reason="rotated"`); insert
       a new row with a freshly generated raw token, same `user_id`,
       `issued_at=now`, and `expires_at` copied verbatim from the old row
       (NOT recomputed as `now + JWT_REFRESH_TTL_DAYS` — the ADR-0013
       absolute-expiry-inheritance rule).
    6. Issue a new access token; set the new raw refresh token as the
       httpOnly cookie (same params as `login()`); return `{access_token}`
       only — no `org_context`/`orgs` (the frontend already holds those from
       login).
    """
    raw_token = request.cookies.get("refresh_token")
    if raw_token is None:
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Your session has expired. Please log in again.",
        )

    token_hash = hash_refresh_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    stored_token = result.scalars().first()

    now = datetime.now(UTC)
    if (
        stored_token is None
        or stored_token.revoked_at is not None
        or stored_token.expires_at < now
    ):
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Your session has expired. Please log in again.",
        )

    # Re-check active org membership (ADR-0013) — same rule as login, but a
    # rejection here does NOT revoke the presented token.
    org_result = await db.execute(
        select(Organization)
        .join(OrgMembership, OrgMembership.org_id == Organization.id)
        .where(
            OrgMembership.user_id == stored_token.user_id,
            OrgMembership.status == OrgMembershipStatus.active,
        )
    )
    orgs = list(org_result.scalars().all())
    if not orgs:
        return _error(
            status.HTTP_403_FORBIDDEN,
            "no_active_organization",
            "Your account has no active organization membership. Contact your administrator.",
        )

    # Rotate: revoke the presented token, issue a new one inheriting the
    # original's absolute expiry.
    stored_token.revoked_at = now
    stored_token.revoked_reason = "rotated"

    new_raw_refresh_token = create_refresh_token(str(stored_token.user_id))
    db.add(
        RefreshToken(
            user_id=stored_token.user_id,
            token_hash=hash_refresh_token(new_raw_refresh_token),
            issued_at=now,
            expires_at=stored_token.expires_at,  # inherited verbatim, ADR-0013
        )
    )
    await db.commit()

    access_token = create_access_token(str(stored_token.user_id))

    response.set_cookie(
        key="refresh_token",
        value=new_raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
    )

    return RefreshResponse(access_token=access_token)


@router.get("/auth/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_actor)) -> MeResponse:
    """Return the current actor's identity (API Document §2, ADR-0013).

    Identity-only for AUTH-2 — no resolved permission codes yet. `User`'s PK
    column is `actor_id`, not `id` (joined-table-inheritance quirk, Database
    Document §3.4) — there is no separate `User.id`.
    """
    return MeResponse(actor_id=str(user.actor_id), email=user.email, actor_type="user")
