# CLAUDE.md — backend

Backend-specific guidance. Read the root `CLAUDE.md` first — this file only covers gotchas specific to `backend/`, found the hard way during REQ-2's and REQ-3's implementation/verification (2026-09-05/06).

## Docker image has no dev dependencies

`Dockerfile` runs `pip install --no-cache-dir .` (main deps only), never `.[dev]` — `pytest`/`httpx`-as-a-test-runner aren't in the built image. Don't try to `docker exec <backend-container> pytest`; it isn't there. Instead:

- Keep a `backend/.venv` (`python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`) and run pytest from the host, pointed at whatever live server you're testing against via `TEST_API_BASE_URL`.
- Re-run `pip install -e ".[dev]"` after any merge/rebase that could have touched `pyproject.toml` — cheap, and catches a drifted venv immediately rather than mid-test-run.

## Testing an isolated stack's integration suite needs the Postgres port exposed too

`docker-compose.yml`'s `postgres` service only `expose`s 5432 (container-network-only) — correct for the app itself (which reaches it by service name), but `backend/tests/integration/*.py` files that seed/clean up via `AsyncSessionLocal` directly (not through the API) need a **host-reachable** port. When standing up an isolated test env (see root `CLAUDE.md`'s isolated-test-env recipe, and `e2e/CLAUDE.md` for the full worked example), add a second `!override` in that stack's `docker-compose.override.test.yml`:

```yaml
services:
  postgres:
    ports: !override
      - "<free-port>:5432"
```

Then `DATABASE_URL=postgresql+asyncpg://testnexa:<password>@localhost:<free-port>/testnexa` for the host-side pytest run. `TEST_API_BASE_URL` stays pointed at the stack's nginx port (or backend port, if exposed directly) — the two env vars serve different halves of each integration test (HTTP calls vs. direct-DB seeding/cleanup).

## `JWT_SECRET` must match between whatever mints your test tokens and the live server verifying them

If a pytest run mints access tokens locally via `app.core.security.create_access_token` (most integration tests do, to skip the login flow) and presents them to a live server running in a container, that container's actual `JWT_SECRET` must match the one your pytest process uses — a mismatch fails signature verification, not something obviously "auth is broken." Read it directly rather than assuming `.env.example`'s default: `docker exec <backend-container> printenv JWT_SECRET`.

## Dev backend container has no source volume mount

Unlike `frontend` (which bind-mounts `frontend/src` for hot reload), `backend`'s dev service builds the image once and does not mount source. After any backend code edit in a running stack (isolated test env or otherwise), you must `docker compose build backend` (or `up --build`) again — editing files on the host does nothing to a running container until rebuilt.

## Seeded demo/test accounts: email domain must not be an IANA reserved special-use domain

Seeding a `User` row directly via `AsyncSessionLocal` (bypassing `POST /auth/signup`'s Pydantic validation) will happily insert an email like `demo@something.local` — the row exists, the password hash is fine, but `POST /auth/login`'s `LoginRequest.email: EmailStr` (`email-validator` under the hood) permanently rejects it with a `422` on every future login attempt, since `.local`/`.test`/`.invalid`/`.example` are IANA reserved special-use **TLDs** per RFC 2606. The frontend then shows a generic "Invalid input" message that reads like a wrong-password error, not a malformed-request one — confusing to debug from the outside (this exact bug shipped in a seeded demo account during REQ-2's manual-verification handoff, 2026-09-06). **Always use a real-shaped domain for any seeded account meant to actually log in** — `@example.com` itself is fine (verified directly against the live validator: only the reserved *TLDs* above are blocked, `example.com`/`.net`/`.org` as second-level domains are not), pick anything that isn't a reserved TLD.

## RBAC bundle extensions always need a new data migration

Every time a bespoke route is gated on a permission code a system role's seeded bundle (`app/db/rbac_seed_catalog.py`) doesn't yet grant, that's a new idempotent Alembic data migration backfilling `role_permission` for already-seeded roles — editing `rbac_seed_catalog.py` alone only affects a fresh DB's initial seed, not one that already ran the seed migration. Three precedents now, same shape each time (existence-check-then-insert): `b7f3a1c9d2e4` (`test_manager`+`release.*`, ADR-0019), and the REQ-3 migration (`test_manager`+`test_condition.*`/`test_case.*`, ADR-0028). Check whether the persona/role your new route's permission targets already holds that code in the seeded bundle *before* considering the route done — a route that 403s for the very role its own story's persona is supposed to use it as is a common miss.

## Before restricting or adding a generic-CRUD `create`, audit for a matching bespoke route

`TestCondition` had a generic `POST /test-conditions` (full CRUD via the ADR-0022 factory) that silently never wrote its `RequirementTestConditionLink` row — the factory's `create_item` only ever inserts the one entity row, it has no concept of a second link-table insert. This went unnoticed until ADR-0028 built the bespoke atomic-create route and discovered the gap. **Whenever an entity's create is meant to also populate a dedicated link table (`app/models/trace.py`), it must never be reachable via the generic factory's plain `create`** — restrict `methods` to drop `"create"` and set `create_schema=None` (mirror `TestCase`'s/`Defect`'s existing exclusion in `app/api/routes/assets.py`/`execution.py`) the same commit the bespoke route is added, not as a follow-up. If you're adding a bespoke atomic-create route for an entity that currently has generic `create` enabled, that's the signal to restrict it now.

## Resolver completeness when adding a bespoke create route (ADR-0029 precedent)

If an entity already has a hand-written `resolve_org_id` function in `app/api/crud_factory.py` (branching/multi-hop resolvers like `TestCase`'s), and you're adding a **new bespoke create route** that produces a row shape the resolver doesn't have a branch for yet, the row will insert successfully and then 404 as "unresolvable tenant" on the very next `GET`/`PATCH`/`DELETE` — a resolver written before that create path existed has no way to know about it. This bit REQ-2 (`POST /requirements/{id}/test-cases`'s direct-link `TestCase` shape had no branch in `resolve_test_case_org_id` until [ADR-0029](../docs/adr/0029-testcase-resolver-direct-link-fallback.md)).

**Before shipping any new bespoke create route for an entity with an existing resolver:** check whether the resolver's branches cover every row shape the new route can produce, and write a create-then-immediate-read integration test, not just a create-response assertion — a create-only test cannot catch this class of bug, since the row genuinely inserts correctly and only the *subsequent read* exposes the gap.
