# CLAUDE.md — backend

Backend-specific guidance. Read the root `CLAUDE.md` first — this file only covers gotchas specific to `backend/`, found the hard way during REQ-2's implementation/verification (2026-09-05/06).

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

## Seeded demo/test accounts: email domain must not be an IANA reserved special-use domain

Seeding a `User` row directly via `AsyncSessionLocal` (bypassing `POST /auth/signup`'s Pydantic validation) will happily insert an email like `demo@something.local` — the row exists, the password hash is fine, but `POST /auth/login`'s `LoginRequest.email: EmailStr` (`email-validator` under the hood) permanently rejects it with a `422` on every future login attempt, since `.local`/`.test`/`.invalid`/`.example` are IANA reserved special-use **TLDs** per RFC 2606. The frontend then shows a generic "Invalid input" message that reads like a wrong-password error, not a malformed-request one — confusing to debug from the outside (this exact bug shipped in a seeded demo account during REQ-2's manual-verification handoff, 2026-09-06). **Always use a real-shaped domain for any seeded account meant to actually log in** — `@example.com` itself is fine (verified directly against the live validator: only the reserved *TLDs* above are blocked, `example.com`/`.net`/`.org` as second-level domains are not), pick anything that isn't a reserved TLD.

## Resolver completeness when adding a bespoke create route (ADR-0028 precedent)

If an entity already has a hand-written `resolve_org_id` function in `app/api/crud_factory.py` (branching/multi-hop resolvers like `TestCase`'s), and you're adding a **new bespoke create route** that produces a row shape the resolver doesn't have a branch for yet, the row will insert successfully and then 404 as "unresolvable tenant" on the very next `GET`/`PATCH`/`DELETE` — a resolver written before that create path existed has no way to know about it. This bit REQ-2 (`POST /requirements/{id}/test-cases`'s direct-link `TestCase` shape had no branch in `resolve_test_case_org_id` until [ADR-0028](../docs/adr/0028-testcase-resolver-direct-link-fallback.md)).

**Before shipping any new bespoke create route for an entity with an existing resolver:** check whether the resolver's branches cover every row shape the new route can produce, and write a create-then-immediate-read integration test, not just a create-response assertion — a create-only test cannot catch this class of bug, since the row genuinely inserts correctly and only the *subsequent read* exposes the gap.
