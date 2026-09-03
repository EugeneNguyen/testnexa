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
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, get_db
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password_or_dummy,
)
from app.models.actor import AIAgent, User
from app.models.auth import AuthIdentity, AuthProvider, LoginAttempt, RefreshToken
from app.models.rbac import Role, RoleAssignment
from app.models.tenancy import Organization, OrgMembership, OrgMembershipStatus
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    OrgSummary,
    RefreshResponse,
    SignupRequest,
)

router = APIRouter()

# ADR-0011 / NFR-11: 5 failed attempts per (client_ip, email) per 15-minute
# sliding window -> 429, until the window clears.
_RATE_LIMIT_WINDOW_MINUTES = 15
_RATE_LIMIT_MAX_ATTEMPTS = 5

# RBAC-1 / ADR-0016: fixed bigint key for `pg_advisory_xact_lock`, acquired
# by every `POST /auth/signup` call before its bootstrap-closed exists-check.
# Serializes concurrent first-signup attempts against each other so exactly
# one Organization results from a race, without needing a row lock on a
# table that may have zero rows at the time. Value is arbitrary (no meaning
# beyond "a fixed constant every signup call agrees on") — picked by keying
# a fixed string through Python's `zlib.crc32` once, at write-time, purely
# so it's stable and doesn't collide with the small integers app code might
# otherwise pick out of habit: `zlib.crc32(b"testnexa:auth:signup:bootstrap")`.
_SIGNUP_BOOTSTRAP_LOCK_KEY = 2214374888


def _error(
    status_code: int,
    code: str,
    message: str,
    field_errors: dict[str, list[str]] | None = None,
) -> JSONResponse:
    """Build an error response matching the API Document §1 error shape."""
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "field_errors": field_errors},
    )


@router.post("/auth/signup", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse | JSONResponse:
    """Bootstrap-only public signup: first-ever User + Organization (RBAC-1, ADR-0016).

    Public — no `get_current_actor` dependency at all. Distinct code path
    from `POST /orgs` (`app/api/routes/organizations.py`): this route takes
    signup credentials for a brand-new `User` and only ever works while zero
    `Organization` rows exist deployment-wide; `POST /orgs` is for an
    already-authenticated actor minting a further org.

    Order of operations:
    1. Acquire `pg_advisory_xact_lock(_SIGNUP_BOOTSTRAP_LOCK_KEY)` FIRST,
       inside this call's transaction, before the exists-check below — two
       concurrent first-signup calls both observing zero orgs before either
       commits would otherwise both succeed (ADR-0016's rejected
       "rely on the slug unique constraint instead" alternative doesn't
       catch this: two concurrent bootstraps typically pick *different*
       slugs). The lock is released automatically when this transaction
       ends (commit on success, rollback on any of the early-return paths
       below), same lifetime as `pg_advisory_xact_lock`'s name implies.
    2. `SELECT EXISTS(SELECT 1 FROM organization)` — any row at all means
       bootstrap has already happened -> `409 signup_closed`. This is
       deliberately checked with the lock already held, not before it.
    3. Hash the password (`hash_password`, same as `login()`'s stored hash);
       create the `User` row; flush alone first so a `User.email` unique
       collision is caught (and reported) independently of the `Organization
       .slug` one two steps later.
    4. Create the `Organization(name=org_name, slug=org_slug)` row; flush
       alone so a `slug` collision is caught (and reported) independently of
       step 3's email collision — `422`, not `409` (`409` is reserved
       exclusively for the bootstrap-closed case in step 2, ADR-0016).
    5. Create the `OrgMembership(status=active)` + an org-wide
       (`project_id=None`) `RoleAssignment` pointing at RBAC-4's seeded
       `org_admin` system `Role` (`org_id IS NULL`) — this row already
       exists from RBAC-4's migration; this route only assigns it, never
       creates a new `Role`.
    6. Issue tokens + set the refresh-token cookie exactly like `login()`
       does (same helpers, same cookie params); commit; return a
       `LoginResponse`-shaped body (`org_context: "auto"`, `orgs: [the new
       org]` — a fresh signup always has exactly one org, never a picker).
    """
    email = payload.email.lower()

    # 1. Advisory lock, acquired before the exists-check, same transaction
    # as every insert below.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": _SIGNUP_BOOTSTRAP_LOCK_KEY}
    )

    # 2. Bootstrap-closed check.
    any_org_id = await db.scalar(select(Organization.id).limit(1))
    if any_org_id is not None:
        await db.rollback()
        return _error(
            status.HTTP_409_CONFLICT,
            "signup_closed",
            "Self-registration is closed. Contact your administrator for an invite.",
        )

    # RBAC-4's seeded org-wide org_admin system Role (org_id IS NULL) — must
    # exist post RBAC-4's migration; not created here (ADR-0016).
    org_admin_role = await db.scalar(
        select(Role).where(Role.name == "org_admin", Role.org_id.is_(None))
    )

    # 3. Create the User; flush alone to isolate an email-uniqueness
    # collision from the org-slug collision step 4 checks separately.
    user = User(name=payload.name, email=email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Request failed validation.",
            field_errors={"email": ["An account with this email already exists."]},
        )

    # 3b. `provider=local` AuthIdentity — required for `login()`'s
    # User-joined-to-AuthIdentity lookup to ever find this user afterward.
    # Without this row, a freshly bootstrapped org_admin gets a token from
    # this response but can never log in again.
    db.add(AuthIdentity(user_id=user.actor_id, provider=AuthProvider.local, is_primary=True))

    # 4. Create the Organization; flush alone to isolate a slug-uniqueness
    # collision (TC-RBAC-003) — 422, not 409 (ADR-0016).
    org = Organization(name=payload.org_name, slug=payload.org_slug)
    db.add(org)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Request failed validation.",
            field_errors={"org_slug": ["This organization slug is already taken."]},
        )

    # 5. Membership + org-wide org_admin RoleAssignment (Q3/ADR-0016: the
    # creator of an org always auto-joins it as its org_admin).
    now = datetime.now(UTC)
    db.add(
        OrgMembership(
            org_id=org.id,
            user_id=user.actor_id,
            status=OrgMembershipStatus.active,
            joined_at=now,
        )
    )
    db.add(
        RoleAssignment(
            actor_id=user.actor_id,
            org_id=org.id,
            project_id=None,
            role_id=org_admin_role.id,
        )
    )

    # 6. Issue tokens; persist the refresh token's hash (ADR-0003) — same
    # shape as login()'s own token-issuance block.
    access_token = create_access_token(str(user.actor_id))
    raw_refresh_token = create_refresh_token(str(user.actor_id))
    db.add(
        RefreshToken(
            user_id=user.actor_id,
            token_hash=hash_refresh_token(raw_refresh_token),
            issued_at=now,
            expires_at=now + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        )
    )
    await db.commit()

    # Refresh token: httpOnly cookie only, never in the JSON body — same
    # params login() sets it with (see that route for the `max_age`/`secure`
    # rationale).
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
        max_age=settings.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    )

    return LoginResponse(
        access_token=access_token,
        org_context="auto",
        orgs=[OrgSummary(id=org.id, name=org.name, slug=org.slug)],
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
    # `max_age` (fix round 2, Finding 1): without it Starlette emits a
    # session cookie (no `Max-Age`/`Expires` on the wire at all), which the
    # browser discards on close — defeating AUTH-2's entire premise of
    # surviving a browser restart even though the DB-side `RefreshToken` row
    # is still live for `JWT_REFRESH_TTL_DAYS`. Tying the cookie's lifetime
    # to that same window keeps the two in sync.
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
        max_age=settings.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
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
    5. Rotate: revoke the presented row (`revoked_reason="rotated"`) via a
       conditional `UPDATE ... WHERE id = :id AND revoked_at IS NULL`
       compare-and-swap (see below), not an ORM attribute-mutation +
       commit; insert a new row with a freshly generated raw token, same
       `user_id`, `issued_at=now`, and `expires_at` copied verbatim from
       the old row (NOT recomputed as `now + JWT_REFRESH_TTL_DAYS` — the
       ADR-0013 absolute-expiry-inheritance rule).
    6. Issue a new access token; set the new raw refresh token as the
       httpOnly cookie (same params as `login()`); return `{access_token}`
       only — no `org_context`/`orgs` (the frontend already holds those from
       login).

    Concurrency (fix round 1 finding): two genuinely concurrent requests
    presenting the SAME still-valid raw token both pass the step-3 read
    check (neither has committed a revocation yet). Revoking via an ORM
    attribute-mutation (`stored_token.revoked_at = now`) + commit is NOT
    safe against this — both requests' `UPDATE`s are unconditional on `id`
    alone, so Postgres serializes them and BOTH succeed, BOTH insert a live
    child token. That silently mints a second live session from a single
    stolen-and-replayed token, breaking ADR-0013's stated guarantee that
    rotation kills every outstanding copy of the old token. The fix is a
    single atomic conditional `UPDATE ... WHERE id = :id AND revoked_at IS
    NULL`, checked by `rowcount`: whichever request's `UPDATE` commits
    first flips `revoked_at` from `NULL`, so the loser's own `UPDATE`
    matches zero rows (its `WHERE` clause no longer holds) and must be
    treated as "already rotated" — 401, no child token inserted, no cookie
    set. This needs no `SELECT ... FOR UPDATE` / row lock held across the
    request; the database's own row-level locking during the `UPDATE`
    itself is sufficient to make exactly one of the two calls win.
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

    # Rotate: revoke the presented token via an atomic compare-and-swap, not
    # an unconditional ORM attribute-mutation + commit — see the docstring's
    # "Concurrency" section. `WHERE id = :id AND revoked_at IS NULL` only
    # matches (and only flips `revoked_at`) if this call is the first to
    # revoke this specific row; a concurrent duplicate call loses the race
    # and gets rowcount == 0 here.
    cas_result = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.id == stored_token.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now, revoked_reason="rotated")
    )
    if cas_result.rowcount != 1:
        # Lost the race: another concurrent request already rotated (or
        # otherwise revoked) this exact row in between our read and our
        # write. Treat identically to "already rotated/revoked" — no child
        # token, no new cookie, nothing to roll back (our UPDATE matched
        # nothing, so there is no partial write to undo).
        await db.rollback()
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_refresh_token",
            "Your session has expired. Please log in again.",
        )

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

    # `max_age` (fix round 2, Finding 1) — same rationale as `login()` above:
    # every rotation must keep re-issuing a persistent cookie, not a session
    # cookie, or the browser-restart guarantee silently degrades back to
    # "until browser close" on the very next refresh after login.
    response.set_cookie(
        key="refresh_token",
        value=new_raw_refresh_token,
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
        max_age=settings.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60,
    )

    return RefreshResponse(access_token=access_token)


@router.get("/auth/me", response_model=MeResponse, response_model_exclude_none=True)
async def me(actor: User | AIAgent = Depends(get_current_actor)) -> MeResponse:
    """Return the current actor's identity (API Document §2, ADR-0013, ADR-0015).

    Identity-only — no resolved permission codes yet. Both `User` and
    `AIAgent`'s PK column is `actor_id`, not `id` (joined-table-inheritance
    quirk, Database Document §3.4) — there is no separate `.id`.

    AUTH-4: `get_current_actor` can now resolve either a `User` (human JWT)
    or an `AIAgent` (`tnx_agent_...` API key, ADR-0015) — branch on
    `isinstance` to serialize the right shape (`MeResponse.email` for a
    `User`, `MeResponse.agent_name` for an `AIAgent`; the other field stays
    `None` either way, per `MeResponse`'s own docstring).

    `response_model_exclude_none=True`: the whichever-is-unset field
    (`email` for an agent, `agent_name` for a human) is omitted from the
    response body entirely rather than serialized as an explicit `null`.
    This keeps the human-actor response body byte-for-byte identical to
    AUTH-2's original `{actor_id, email, actor_type}` shape (no new
    `"agent_name": null` key appearing) — additive on the wire only when an
    `AIAgent` is actually the caller, per the plan's "additive" framing.
    """
    if isinstance(actor, AIAgent):
        return MeResponse(actor_id=str(actor.actor_id), actor_type="ai_agent", agent_name=actor.agent_name)
    return MeResponse(actor_id=str(actor.actor_id), actor_type="user", email=actor.email)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    actor: User | AIAgent = Depends(get_current_actor),
) -> Response:
    """Revoke the caller's current-session refresh token; idempotent (ADR-0014).

    `actor` typed `User | AIAgent`, not just `User`, since `get_current_actor`
    (AUTH-4) now resolves either — an `AIAgent` bearer credential is
    structurally accepted here rather than rejected outright (no story has
    asked for an agent-specific 403 on this route) but is a no-op in
    practice: agents never hold a `refresh_token` cookie session (ADR-0003 —
    bearer-key auth only, no cookie exchange), so `raw_token` is always
    absent and the request just falls through to the idempotent-204 path.

    No request body. Authenticated the same way `me()` is — a missing/
    invalid/expired bearer access token 401s via `get_current_actor` before
    this handler ever runs (`code: "invalid_token"`, the same generic body
    `GET /auth/me` produces). That is the ONLY non-2xx outcome this route
    ever produces.

    Order of operations (ADR-0014 / API Document §2):
    1. Read the `refresh_token` httpOnly cookie, same as `refresh()`. Missing
       entirely -> nothing to revoke, fall through to the success response.
    2. If present, hash it and attempt to revoke the matching `RefreshToken`
       row via the same atomic conditional `UPDATE ... WHERE ... AND
       revoked_at IS NULL` compare-and-swap `refresh()` uses (see that
       route's docstring "Concurrency" section for why this must be a CAS
       and not an ORM attribute-mutation + commit) — NOT an unconditional
       `UPDATE` keyed on `token_hash` alone. The `WHERE` clause here also
       scopes on `user_id = :authenticated_user_id`, which `refresh()`'s
       version has no need for (it only ever sees the token's own claimed
       owner): this closes the case where the authenticated caller's bearer
       token and their `refresh_token` cookie name different users, so
       logout can never revoke a session it doesn't own.
    3. Whatever the CAS `rowcount` turns out to be — 1 (a live session
       belonging to this user was revoked), or 0 (no cookie, hash not
       found, already revoked/rotated-out, or the row belongs to a
       different user) — the response is identical: `204 No Content`. This
       is deliberate, not a shortcut: logout's job is "make sure this
       session is dead," and in every zero-rowcount case it already is. No
       distinct error code is exposed per-cause (same no-enumeration-leak
       posture `refresh()`'s `invalid_refresh_token` takes).
    4. Clear the `refresh_token` cookie on the response regardless of
       whether anything was revoked server-side, with the exact same
       `httponly`/`samesite`/`secure` attributes `login()`/`refresh()` set
       it with — some browsers won't recognize a `delete_cookie` call as
       targeting the same cookie otherwise and will leave the stale value
       sitting in the jar (harmless server-side, since the DB row is dead
       either way, but sloppy).

    The access token itself is never invalidated here — it remains usable
    until its own short TTL naturally lapses (AUTH-3 AC2, out of scope for
    this route; no token-blocklist exists in this scaffold).
    """
    raw_token = request.cookies.get("refresh_token")
    if raw_token is not None:
        token_hash = hash_refresh_token(raw_token)
        now = datetime.now(UTC)
        await db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.user_id == actor.actor_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoked_reason="logout")
        )
        await db.commit()

    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        samesite="lax",
        secure=(settings.ENV != "dev"),
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
