# CLAUDE.md — backend

Backend-specific guidance. Read the root `CLAUDE.md` first — this file only covers gotchas specific to `backend/`, found the hard way during REQ-2's, REQ-3's, and REQ-4's implementation/verification (2026-09-05/06).

## `TEST_API_BASE_URL` must NOT include `/api` when pointed at nginx

`nginx/nginx.dev.conf`'s `location /api/` passes a request straight through to `backend:8000/api/` unchanged — no path rewrite. Every integration test file builds its own request paths as `f"{TEST_API_BASE_URL}{API_PREFIX}/..."`, and `API_PREFIX = "/api/v1"` already carries the `/api` segment. So the correct base URL against an nginx-fronted stack is the bare host:port (`http://localhost:<port>`), **not** `http://localhost:<port>/api` — `backend/README.md`'s own worked example had this wrong (fixed 2026-09-06) and is exactly the kind of thing worth re-verifying against `nginx/nginx.dev.conf` directly rather than trusting a remembered convention.

Appending `/api` yourself double-prefixes every real feature route to `/api/api/v1/...`. Nginx still forwards it happily (it just strips nothing), but FastAPI's own router then 404s on its own terms with a plain `{"detail": "Not Found"}` body — **no `code` key** — which looks exactly like an application-level tenant-boundary 404 (`{"code": "not_found", ...}`) until you actually diff the two bodies. This bit a REQ-4 verification pass hard: 12 real, passing tests all failed with `KeyError: 'code'` on the first assertion, which reads like a application regression, not a one-character path bug. **When every test in a file fails the same way at the same assertion shape, suspect the harness config (base URL, wrong prefix) before the code under test** — a quick `curl` of one endpoint directly, comparing the raw body to what the route's own source says it returns, settles it in seconds.

The one thing this doesn't fix: `tests/integration/conftest.py`'s skip-guard and `test_health_api.py`/`test_rbac_seed.py`'s own assertions call bare `f"{TEST_API_BASE_URL}/health"` (no prefix at all), and nginx has no bare `/health` location — only `/api/health` and `/`. Those two tests fail against nginx either way; see `e2e/CLAUDE.md`'s "known, harmless failures" note, and don't reach for the old `/api`-suffixed base to silence them — that trade breaks every other integration test instead.

## Docker image has no dev dependencies

`Dockerfile` runs `pip install --no-cache-dir .` (main deps only), never `.[dev]` — `pytest`/`httpx`-as-a-test-runner aren't in the built image. Don't try to `docker exec <backend-container> pytest`; it isn't there. Instead:

- Keep a `backend/.venv` (`python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`) and run pytest from the host, pointed at whatever live server you're testing against via `TEST_API_BASE_URL`.
- **`source .venv/bin/activate` does not persist across separate tool-call/subprocess invocations** — each one starts a fresh shell. `which python3` after a `source` in an earlier call will still resolve to the system/Homebrew Python, silently running your tests (or failing to find `sqlalchemy` et al.) against the wrong interpreter. Invoke the venv's binaries directly instead: `./.venv/bin/python -m pytest ...`, `./.venv/bin/pytest ...` — this works regardless of whether `activate` ran in the same shell.
- Re-run `pip install -e ".[dev]"` after any merge/rebase that could have touched `pyproject.toml` — cheap, and catches a drifted venv immediately rather than mid-test-run.
- If `source .venv/bin/activate && pip ...` fails with something like `bad interpreter: .../python3.8: no such file or directory`, the venv's own shebang/`pyvenv.cfg` points at a Python that no longer exists on this machine (a venv carries absolute paths, so one created on a different host/container/session doesn't travel) — don't debug it, `rm -rf .venv` and recreate. Cheaper than chasing it, and this repo has hit it more than once.

## Testing an isolated stack's integration suite needs the Postgres port exposed too

`docker-compose.yml`'s `postgres` service only `expose`s 5432 (container-network-only) — correct for the app itself (which reaches it by service name), but `backend/tests/integration/*.py` files that seed/clean up via `AsyncSessionLocal` directly (not through the API) need a **host-reachable** port. When standing up an isolated test env (see root `CLAUDE.md`'s isolated-test-env recipe, and `e2e/CLAUDE.md` for the full worked example), add a second `!override` in that stack's `docker-compose.override.test.yml`:

```yaml
services:
  postgres:
    ports: !override
      - "<free-port>:5432"
```

Then `DATABASE_URL=postgresql+asyncpg://testnexa:<password>@localhost:<free-port>/testnexa` for the host-side pytest run. `TEST_API_BASE_URL` stays pointed at the stack's nginx port (or backend port, if exposed directly) — the two env vars serve different halves of each integration test (HTTP calls vs. direct-DB seeding/cleanup).

**`<password>` is not the value you remember from a different session's `.env`** — same "read the actual env, don't assume a remembered default" trap as `JWT_SECRET` below, but for Postgres: `docker exec <project>-postgres-1 printenv POSTGRES_PASSWORD` first. Guessing (`testnexa`, the DB *username*, is a tempting wrong guess) produces `asyncpg.exceptions.InvalidPasswordError` buried several frames deep in a SQLAlchemy flush traceback — it reads exactly like a real ORM/session bug, not an auth mismatch, and hit every single test in a file identically (PLAN-2 verification pass, 2026-09-06) before the actual line was found. Same "every test fails the same way at the same point → suspect the harness env, not the code" instinct this file already teaches for `JWT_SECRET`/`TEST_API_BASE_URL`.

**Forgetting `DATABASE_URL` doesn't fail loudly or selectively** — `app/core/config.py`'s own default (`localhost:5432`) silently points at whatever's listening on the *host's* default Postgres port (nothing, if you only ever run Postgres in Docker), so every single test that seeds/cleans up via `AsyncSessionLocal` fails identically with an asyncpg `OSError: Multiple exceptions: [Errno 61] Connect call failed`. Same diagnostic instinct as the `/api`-double-prefix note above: **when every test in a file fails the same way at the same point, suspect a missing/wrong env var before the code under test** — confirmed 2026-09-06, `TEST_API_BASE_URL` alone (no `DATABASE_URL`) → 20/20 false failures in one file, fixed by adding the one env var.

## `JWT_SECRET` must match between whatever mints your test tokens and the live server verifying them

If a pytest run mints access tokens locally via `app.core.security.create_access_token` (most integration tests do, to skip the login flow) and presents them to a live server running in a container, that container's actual `JWT_SECRET` must match the one your pytest process uses — a mismatch fails signature verification, not something obviously "auth is broken." Read it directly rather than assuming `.env.example`'s default: `docker exec <backend-container> printenv JWT_SECRET`.

## Dev backend container has no source volume mount

Unlike `frontend` (which bind-mounts `frontend/src` for hot reload), `backend`'s dev service builds the image once and does not mount source. After any backend code edit in a running stack (isolated test env or otherwise), you must `docker compose build backend` (or `up --build`) again — editing files on the host does nothing to a running container until rebuilt.

**`docker compose up --build` can exit `0` while the image build itself actually failed** (observed: a transient registry TLS timeout mid-layer-pull) — Compose still brings up whatever image already exists (the *previous* build), so the container starts fine and looks healthy, but silently runs stale code with zero indication anything went wrong. Combined with the no-volume-mount fact above, this is a real trap: don't trust the exit code alone after any rebuild you're about to test against. Verify the new code is actually live — check the build log's own tail for a real completion line (not just Compose's own "done" summary), or curl/exercise something the new code specifically changes (a new route, a new field) and confirm the *new* behavior, not just a `200`.

A second symptom of the same underlying trap, not a silent `0`: `up --build -d backend` can instead **stall at zero CPU and exit non-zero** (observed: `144`) — same fix either way, don't trust the exit code or a "container is Up" status, rebuild in the foreground and `grep` the container for a string only the new code introduces before believing it's live (confirmed 2026-09-06, PLAN-2: the running container had zero occurrences of a field the just-edited code should have added, foreground rebuild fixed it).

## Seeded demo/test accounts: email domain must not be an IANA reserved special-use domain

Seeding a `User` row directly via `AsyncSessionLocal` (bypassing `POST /auth/signup`'s Pydantic validation) will happily insert an email like `demo@something.local` — the row exists, the password hash is fine, but `POST /auth/login`'s `LoginRequest.email: EmailStr` (`email-validator` under the hood) permanently rejects it with a `422` on every future login attempt, since `.local`/`.test`/`.invalid`/`.example` are IANA reserved special-use **TLDs** per RFC 2606. The frontend then shows a generic "Invalid input" message that reads like a wrong-password error, not a malformed-request one — confusing to debug from the outside (this exact bug shipped in a seeded demo account during REQ-2's manual-verification handoff, 2026-09-06). **Always use a real-shaped domain for any seeded account meant to actually log in** — `@example.com` itself is fine (verified directly against the live validator: only the reserved *TLDs* above are blocked, `example.com`/`.net`/`.org` as second-level domains are not), pick anything that isn't a reserved TLD.

## RBAC bundle extensions always need a new data migration

Every time a bespoke route is gated on a permission code a system role's seeded bundle (`app/db/rbac_seed_catalog.py`) doesn't yet grant, that's a new idempotent Alembic data migration backfilling `role_permission` for already-seeded roles — editing `rbac_seed_catalog.py` alone only affects a fresh DB's initial seed, not one that already ran the seed migration. Three precedents now, same shape each time (existence-check-then-insert): `b7f3a1c9d2e4` (`test_manager`+`release.*`, ADR-0019), and the REQ-3 migration (`test_manager`+`test_condition.*`/`test_case.*`, ADR-0028). Check whether the persona/role your new route's permission targets already holds that code in the seeded bundle *before* considering the route done — a route that 403s for the very role its own story's persona is supposed to use it as is a common miss.

## Before restricting or adding a generic-CRUD `create`, audit for a matching bespoke route

`TestCondition` had a generic `POST /test-conditions` (full CRUD via the ADR-0022 factory) that silently never wrote its `RequirementTestConditionLink` row — the factory's `create_item` only ever inserts the one entity row, it has no concept of a second link-table insert. This went unnoticed until ADR-0028 built the bespoke atomic-create route and discovered the gap. **Whenever an entity's create is meant to also populate a dedicated link table (`app/models/trace.py`), it must never be reachable via the generic factory's plain `create`** — restrict `methods` to drop `"create"` and set `create_schema=None` (mirror `TestCase`'s/`Defect`'s existing exclusion in `app/api/routes/assets.py`/`execution.py`) the same commit the bespoke route is added, not as a follow-up. If you're adding a bespoke atomic-create route for an entity that currently has generic `create` enabled, that's the signal to restrict it now.

## Hand-seeding a `User` row: never construct `Actor()` yourself

`User`/`AIAgent` are SQLAlchemy joined-table inheritance subclasses of `Actor` (Database Document §3.4's "known drift" note — `actor_id` is both PK and the FK to `actor.id`, no separate `id` column). The correct, working pattern — used by every seed script in `e2e/tests/*.spec.ts` — is `User(name=..., email=..., password_hash=...)` directly; the mapper inserts the parent `Actor` row itself as part of persisting the subclass. **Manually creating `Actor(actor_type=ActorType.user)` first, flushing it, then constructing `User(actor_id=actor.id, ...)`** looks reasonable and is wrong: it throws off the joined-table mapper's own identity tracking (a `SAWarning: Flushing object <Actor> with incompatible polymorphic identity` is the tell), and a later `commit()` fails with a `ForeignKeyViolationError` on whatever child row references `actor_id` next — `org_membership_user_id_fkey` in the case that surfaced this (2026-09-06) — even though the `Actor` insert itself appeared to succeed. If you're writing a one-off seed script and not copying an existing e2e spec's pattern verbatim, grep `e2e/tests/req1-requirements-ui.spec.ts`'s `SEED_SCRIPT` first.

## A DB cloned from `main` is signup-closed and its real user's password is unrecoverable

`POST /auth/signup` (`app/api/routes/auth.py`) is bootstrap-only — it 409s `signup_closed` the moment any `Organization` row exists. Any isolated stack cloned from `main`'s DB (the standard recipe, root `CLAUDE.md`/`e2e/CLAUDE.md`) inherits `main`'s already-bootstrapped org, so you cannot create a fresh account via signup on a clone — confirmed 2026-09-06. `main` currently has exactly one seeded `User` (`admin@example.com`), and its `password_hash` is a real argon2 hash from an actual signup, not seeded by any migration/script in this repo — there is no way to recover or guess the plaintext.

**For a manual-test handoff that needs a working login on a cloned stack**, reset that user's password directly in the *clone only*, using the app's own hasher so the hash is verifiable by the running server:

```
docker exec <clone-backend-container> python -c \
  "from app.core.security import hash_password; print(hash_password('<new-password>'))"
# then, against the clone's postgres only:
docker exec <clone-postgres-container> psql -U testnexa -d testnexa \
  -c "UPDATE \"user\" SET password_hash = '<hash from above>' WHERE email = 'admin@example.com';"
```

Never run the `UPDATE` against `testnexa-postgres-1` (main) — this is a clone-only reset, and the whole point is that main's real credential stays untouched and unknown to the agent.

## Resolver completeness when adding a bespoke create route (ADR-0029 precedent)

If an entity already has a hand-written `resolve_org_id` function in `app/api/crud_factory.py` (branching/multi-hop resolvers like `TestCase`'s), and you're adding a **new bespoke create route** that produces a row shape the resolver doesn't have a branch for yet, the row will insert successfully and then 404 as "unresolvable tenant" on the very next `GET`/`PATCH`/`DELETE` — a resolver written before that create path existed has no way to know about it. This bit REQ-2 (`POST /requirements/{id}/test-cases`'s direct-link `TestCase` shape had no branch in `resolve_test_case_org_id` until [ADR-0029](../docs/adr/0029-testcase-resolver-direct-link-fallback.md)).

**Before shipping any new bespoke create route for an entity with an existing resolver:** check whether the resolver's branches cover every row shape the new route can produce, and write a create-then-immediate-read integration test, not just a create-response assertion — a create-only test cannot catch this class of bug, since the row genuinely inserts correctly and only the *subsequent read* exposes the gap.

## Gate completeness when nesting a new resource onto an existing bespoke read route (ADR-0032 precedent)

The create-route version of this class of gap is the resolver-completeness note above; the read-route version is the *permission-gate*. `GET /releases/{id}/test-cycles` (ADR-0019) was already an unusual multi-permission-gated route (`release.read` AND `test_cycle.read` AND `test_execution.read`) precisely because it exposes data from more than one resource without any of their ids in the request path. PLAN-2 (ADR-0032) nested a fourth resource's rows (`EntryExitCriteria`) onto that same response — the permission list had to widen to a quadruple (`+ entry_exit_criteria.read`) in the same change, or the route would silently start returning a resource's data to callers never granted read on it. **If you're nesting an existing entity's rows onto a route that already gates on 2+ permissions for the resources it *already* exposes, adding that entity's own `.read` code to the gate is part of the same change, not a follow-up** — write the negative test (grant everything except the new code, assert `403`) in the same commit, since none of the existing tests for the pre-existing permissions can catch a gate that was never widened.
