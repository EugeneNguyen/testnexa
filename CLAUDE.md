# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repo.

## What this is

TestNexa: a self-hosted, ISTQB/IEEE 829-aligned test management tool (React frontend, FastAPI backend, Postgres, Docker Compose), built around human + AI-agent collaboration as first-class actors. Full context: [business case](docs/business-case/2026-09-03-sovereign-ai-testing-business-case.md), [personas](docs/personas/2026-09-03-target-personas.md), [requirements](docs/requirements/2026-09-03-project-scaffold-requirements.md), [ADR index](docs/adr/README.md).

## Repo layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLAlchemy 2.0 + Alembic, Python 3.11+ — has its own [`CLAUDE.md`](backend/CLAUDE.md) (Docker-image dev-deps gap, isolated-stack DB port exposure, `JWT_SECRET` matching, resolver-completeness) |
| `frontend/` | Vite + React + TypeScript — has its own [`CLAUDE.md`](frontend/CLAUDE.md) (nested-table a11y-name gotcha, unit-test coverage history) |
| `e2e/` | Playwright, runs against the full docker-compose stack — has its own [`CLAUDE.md`](e2e/CLAUDE.md) (the full isolated-stack-plus-Playwright worked recipe) |
| `docs/adr/` | Architecture Decision Records — **read before changing stack/architecture choices** |
| `docs/requirements/`, `docs/database/`, `docs/api/` | Canonical requirements/schema/API contracts |
| `docs/test-plan/`, `docs/test-design/`, `docs/test-cases/` | Test strategy, techniques, concrete test cases |
| `docs/user-stories/` | Source acceptance criteria, one file per feature area |
| `docs/superpowers/plans/` | Per-story implementation/scope plans |

Each subfolder's `CLAUDE.md` covers gotchas specific to that area only — read the relevant one before working there, in addition to (not instead of) this file. If you create a new top-level working directory that accumulates its own hard-won gotchas, give it a `CLAUDE.md` too and link it here, same pattern.

## Design system: CoreUI for React

**CoreUI (https://coreui.io/) is the project's design system**, per [ADR-0012](docs/adr/0012-coreui-design-system.md). This supersedes Tailwind, which ADR-0009 originally picked — do not add new Tailwind classes anywhere.

- Packages: `@coreui/react` + `@coreui/coreui` (open-source tier — not `-pro` unless a future ADR says otherwise). Icons: `@coreui/icons` + `@coreui/icons-react`.
- CSS: `@coreui/coreui/dist/css/coreui.min.css`, imported once in `frontend/src/main.tsx`.
- Build UI from CoreUI's components first (`CButton`, `CForm`/`CFormInput`, `CCard`, `CModal`, `CTable`, `CNavbar`, `CAlert`, `CTabs`, `CTooltip`, `CToast`, etc.) — don't hand-roll a component CoreUI already ships.
- Icons via `CIcon`: `import { CIcon } from '@coreui/icons-react'; import { cilList } from '@coreui/icons'; <CIcon icon={cilList} />`. No second icon library.
- React Hook Form + Zod still own form state/validation (ADR-0009, unchanged) — CoreUI just supplies the input components they bind to.
- **Do not run Tailwind and CoreUI together.** CoreUI's CSS is Bootstrap-family and its `.container`/grid/reset classes collide with Tailwind's own `container` utility and Preflight reset — see ADR-0012 for why this isn't a style preference, it's a real cascade-conflict risk.
- Tailwind is fully removed as of 2026-09-03 — `tailwindcss`/`postcss`/`autoprefixer` deps and `tailwind.config.js`/`postcss.config.js` are gone, every screen (`Login`, `OrgPicker`, `OrgHome`, the root scaffold-verification page) is CoreUI. Don't reintroduce a Tailwind class or config file.

## Running the stack

```
cp .env.example .env
docker compose --profile dev up --build
```

Open `http://localhost:54593` (or the host's LAN IP, same port) — nginx is the single external entrypoint (`/api/*` → backend, `/*` → frontend), per [ADR-0010](docs/adr/0010-single-port-docker-compose-topology.md). `postgres-test` starts alongside but is idle until the integration suite runs against it.

**Never run ad hoc Docker commands against the main `testnexa` compose project when testing a change in progress.** Stand up an isolated test environment instead (new `-p` project name, random free port, DB cloned from main via `pg_dump`/`psql`, `docker-compose.override.test.yml`-style port override using the Compose `!override` merge tag) so main stays untouched. **[`e2e/CLAUDE.md`](e2e/CLAUDE.md) has the full worked recipe** (port/project naming, the `!override` gotcha, DB clone + verification, migrating, both-IP health-checking, and known-harmless failures when testing through this topology) — read it before improvising your own.

## Testing

Three layers, all real (not mocked-everything):

- **Backend unit** (`backend/tests/unit/`) — pytest, no DB/network.
- **Backend integration** (`backend/tests/integration/`) — pytest + httpx against a *live* server (`TEST_API_BASE_URL` env var), real Postgres. The package-level `conftest.py` skips the whole suite cleanly if no live server is reachable — don't fight that, bring the stack up first.
  - If a test file uses the shared `app.db.session.AsyncSessionLocal` engine directly for seeding/cleanup, the pytest run needs a **session-scoped event loop** (`asyncio_default_fixture_loop_scope = "session"` / `asyncio_default_test_loop_scope = "session"` in `pyproject.toml`, already set) — asyncpg connections can't hop event loops, and pytest-asyncio's default is a fresh loop per test.
- **Frontend unit** — Vitest + React Testing Library.
- **E2E** (`e2e/`) — Playwright, real browser, full stack, `E2E_BASE_URL` overridable.

Every FR/NFR traces to a test case in `docs/test-cases/`. When implementing a story, check that doc's coverage for the story ID before considering it done — 100% means every TC for *that story's own scope* has a passing automated test, not that every TC in the file (some belong to other, not-yet-built stories) is green.

**Match a TC's literal wording, not a semantically-adjacent assertion.** A test case that names a specific action (e.g. TC-REQ-004's "add 3 steps, **reorder**") needs a test that actually performs that literal action — an "add steps and edit one field" test doesn't satisfy a TC that also says "reorder," even though both fall under the same general "TestStep CRUD" umbrella. This gap shipped and sat undetected through one full doc-propagation pass before being caught (REQ-2, 2026-09-06) — when auditing coverage, read each TC's `Steps`/`Expected result` cells word-for-word against what the test file actually does, don't pattern-match on the general shape.

## Architecture decisions are ADR-first

Every stack/architecture choice in this repo has an ADR in `docs/adr/` (MADR-style: Context/Decision/Consequences/Alternatives). Before making or changing one:

1. Check `docs/adr/README.md` — it might already be decided.
2. If you're changing a prior decision (like this file's CoreUI-vs-Tailwind change did to ADR-0009), write a new ADR and mark the old one's status `Partially superseded` / `Superseded`, don't silently edit history.
3. Requirements/WBS/API/Database docs get updated to match whenever an ADR changes something they document — see how ADR-0011 (login rate limiting) propagated across 7 docs in this repo's history for the expected scope of that propagation.

## Auth & security conventions (ADR-0003, ADR-0011)

- Passwords: argon2 via passlib, explicit cost params, never logged in plaintext anywhere (app logs, tracebacks, request-logging middleware).
- Human login: JWT access token (short-lived) + opaque refresh token, refresh token hash stored server-side (`refresh_token` table, revocable), raw refresh token delivered only via an httpOnly cookie — never in a JSON body.
- Login is rate-limited: 5 failed attempts per `(client_ip, email)` per 15 minutes → 429; resets on a successful login for that pair.
- Unknown email and wrong password return the **identical** generic 401 body — no user-enumeration leak, timing-safe (always run the password-verify code path, real hash or a fixed dummy hash).
- AI agents (`AIAgent`, joined-table-inheritance sibling of `User` under `Actor`) authenticate via a separate long-lived API-key bearer flow, never the human login route.
- **Seeded demo/test accounts must use a real-shaped email domain.** Inserting a `User` row directly (bypassing `POST /auth/signup`'s Pydantic validation) accepts any string in `email`, but `POST /auth/login`'s `EmailStr` validation permanently rejects IANA reserved special-use **TLDs** (`.local`, `.test`, `.invalid`, `.example`) with a `422` — the frontend then shows a generic "check your email and password" message that reads like wrong credentials, not a malformed address. `@example.com` itself is fine (verified against the live validator — only the reserved *TLDs* are blocked, not that specific second-level domain). Bit a real demo handoff, 2026-09-06 (see `backend/CLAUDE.md` for the full story).

## Multi-tenancy (ADR-0007)

Every tenant-scoped table carries a resolvable `org_id` path. Cross-tenant resource access returns **404**, never 403 — existence is never confirmable across an org boundary (NFR-1). Don't add a query that skips the `org_id` filter, generic or bespoke.

**When adding a new bespoke create route for an entity that already has a hand-written resolver** (`app/api/crud_factory.py`'s per-entity `resolve_org_id` functions), check the resolver's branches actually cover the row shape your new route produces — a resolver written before that create path existed has no branch for it, so the row inserts fine and then 404s as "unresolvable" on the very next read. See [ADR-0028](docs/adr/0028-testcase-resolver-direct-link-fallback.md) for the concrete case (REQ-2's direct-link `TestCase`) and `backend/CLAUDE.md` for the general rule. Test with a create-then-immediate-read round trip, not a create-only assertion — the latter cannot catch this class of bug.

## Git / worktrees

Feature work happens in an isolated git worktree (`.claude/worktrees/<name>`), one per story/task, so `main` and other in-flight work stay untouched. Don't `git stash` bare — the stash stack is shared across worktrees; use a WIP commit or a tagged `stash push -u -m "<unique-tag>"` instead.
