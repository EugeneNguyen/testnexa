# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repo.

## What this is

TestNexa: a self-hosted, ISTQB/IEEE 829-aligned test management tool (React frontend, FastAPI backend, Postgres, Docker Compose), built around human + AI-agent collaboration as first-class actors. Full context: [business case](docs/business-case/2026-09-03-sovereign-ai-testing-business-case.md), [personas](docs/personas/2026-09-03-target-personas.md), [requirements](docs/requirements/2026-09-03-project-scaffold-requirements.md), [ADR index](docs/adr/README.md).

## Repo layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLAlchemy 2.0 + Alembic, Python 3.11+ — has its own [`CLAUDE.md`](backend/CLAUDE.md) (Docker-image dev-deps gap, isolated-stack DB port exposure + password, `JWT_SECRET` matching, resolver/gate completeness, `TEST_API_BASE_URL`-vs-nginx double-prefix trap) |
| `frontend/` | Vite + React + TypeScript — has its own [`CLAUDE.md`](frontend/CLAUDE.md) (nested-table a11y-name gotcha, unit-test coverage history, `frontend/tests/` location convention) |
| `e2e/` | Playwright, runs against the full docker-compose stack — has its own [`CLAUDE.md`](e2e/CLAUDE.md) (the full isolated-stack-plus-Playwright worked recipe, concurrent-run false-positive traps) |
| `docs/adr/` | Architecture Decision Records — **read before changing stack/architecture choices** |
| `docs/requirements/`, `docs/database/`, `docs/api/` | Canonical requirements/schema/API contracts |
| `docs/test-plan/`, `docs/test-design/`, `docs/test-cases/` | Test strategy, techniques, concrete test cases |
| `docs/user-stories/` | Source acceptance criteria, one file per feature area |
| `docs/superpowers/plans/` | Per-story implementation/scope plans |
| `docs/` (general) | Has its own [`CLAUDE.md`](docs/CLAUDE.md) (TC-ID numbering must be grepped, not eyeballed; the API doc's asterisk-count footnote convention is fragile) |

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

**Never run ad hoc Docker commands against the main `testnexa` compose project when testing a change in progress.** Stand up an isolated test environment instead — validated recipe (run against AUTH-1, REQ-2, and REQ-3):

1. **Name it `testnexa-<purpose>-test`** (compose `-p` flag) — before picking a port, run `docker compose ls` and check for a stale one from a prior session that was never torn down (background/orchestrated work can die without cleaning up after itself, see "Working with agents" below).
2. **Random 5-digit port**, checked free with `lsof -i :<port>` and against `docker ps`.
3. **Build context is the worktree**, not the main repo root, or the isolated stack won't actually contain the branch's code: `docker compose -p testnexa-<purpose>-test -f docker-compose.yml -f docker-compose.override.test.yml --profile dev up --build -d` run from inside the worktree directory.
4. **Port override**: a `docker-compose.override.test.yml` in the worktree overriding `nginx-dev`'s `ports:` — Compose list-merges `ports` by default (appends, doesn't replace), so use the YAML `!override` merge tag on that key. Bind as `"<port>:80"`, not `"127.0.0.1:<port>:80"`, so it's reachable via both `localhost` and the host's LAN IP (same as main's own `0.0.0.0:54593->80`).
5. **Clone main's DB**, don't start empty: `docker exec testnexa-postgres-1 pg_dump -U testnexa -d testnexa -F c -f /tmp/clone.dump`, copy out, restore into the new stack's `postgres` service, then run `alembic upgrade head` inside the new backend container for any migration the branch adds on top of the clone.
6. **Backend has no dev volume mount** (unlike `frontend`, which bind-mounts `src`) — after any backend code edit, `docker compose build backend` (or `up --build`) again, or you're silently testing stale code.
7. **Tear down with `docker compose -p testnexa-<purpose>-test down -v`** when done — removes containers, network, and the cloned DB volume. Full worked example (seed/cleanup script pattern too): [`e2e/CLAUDE.md`](e2e/CLAUDE.md).

**A `docker-compose.override.test.yml` is gitignored — it does not travel with `git worktree add`.** Untracked files exist only in the working tree that created them; a *new* worktree starts clean even though the file is still sitting at the main repo root from a past session. Confirmed 2026-09-06: a stray root-level override (port 17935, no running containers behind it, no commit history — just never cleaned up) was invisible inside a freshly created worktree; the fix was to write a fresh correct override file in the new worktree, not to "edit" one that wasn't there. Two takeaways: (a) don't assume a prior session's override file is reachable from wherever you're working now — check with `ls`/`git status --porcelain` in the actual worktree first; (b) a stray override file at repo root is the same class of cleanup miss as an untorn-down container (see "Working with agents" below) — `ls docker-compose.override*.yml` at repo root is worth a glance alongside the usual `docker compose ls` audit.

## Working with agents / long-running background work

A background or resumed sub-agent can die silently with no completion record if its parent process exits mid-task (observed twice now on the same class of task: a `ceo-orchestrator` given a multi-hour implement+test task stopped with no transcript marker after being resumed, then — resumed a second time with a `SendMessage`, given a clear "don't stop until done" instruction — stopped again with no completion record, REQ-4, 2026-09-06). **Treat this as the expected failure mode for any multi-hour orchestrated task, not a one-off**: don't assume a second resume will finish what the first one didn't. **Never take a sub-agent's self-reported "done" at face value, and don't stop verifying after the first check either** — after *every* resume or apparent stop, independently re-verify: `git status`/`git diff --stat` in the actual worktree, `docker ps`/`docker compose ls` for what's actually running, and re-run the test suites yourself before reporting results as fact. In practice this means: read whatever the agent *did* leave on disk (files, partial test output) before deciding whether to resume it again or just finish the remaining work directly — a stopped orchestrator's on-disk artifacts are often further along than its last transcript message suggests, and picking up from there is faster than a third resume attempt.

**[`e2e/CLAUDE.md`](e2e/CLAUDE.md) has the full worked recipe** (port/project naming, the `!override` gotcha, DB clone + verification, migrating, both-IP health-checking, and known-harmless failures when testing through this topology) — read it before improvising your own.

**The independent-reverify habit above keeps paying off, not just for stopped orchestrators.** A PLAN-1 verification pass (2026-09-06) re-ran every layer of a sub-agent's self-reported "all green" results directly and caught four real things the transcript alone would have missed: an integration run that silently connected to the wrong Postgres (missing `DATABASE_URL`, see `backend/CLAUDE.md`), a "26 e2e failures" false alarm from an unset container-name override (see `e2e/CLAUDE.md`), a stale-diagnostic false positive on brand-new frontend files (see `frontend/CLAUDE.md`), and a broken hand-seed script of its own construction (`Actor()`-then-`User()`, see `backend/CLAUDE.md`). None of the four were flagged by the agent's own report as a concern — re-running the actual commands, not re-reading the summary, is what surfaced each one.

**Even a foreground (non-backgrounded) orchestrator call can legitimately return before the task is actually done.** Don't assume `run_in_background: false` means the tool call blocks until full completion — a `ceo-orchestrator` given a large multi-workstream task (PLAN-3, 2026-09-06: stand up an env, implement, write 4 layers of tests) returned mid-task with an honest status report and a resume handle ("waiting on the integration-test workstream... will report fully once it lands") rather than either finishing or dying silently. This is the *good* version of the known failure mode above, not a new bug — but it still means "don't return until every subagent is done" requires an explicit `SendMessage`-based resume loop (relay whatever the just-finished child reported, tell it to continue), not a single blocking call. Budget for at least one resume round-trip on any task big enough to spawn its own sub-agents.

**Two independent workstreams (two sub-agents, or a sub-agent and a manual run) hitting the same isolated stack's Postgres concurrently is a real false-positive source, not just a same-suite parallelism concern.** `e2e/CLAUDE.md`'s "concurrent-run" note already covers multiple Playwright workers/runs against one stack; PLAN-3 (2026-09-06) hit the same class of problem one level up — an orchestrator's backend-integration sub-agent and its e2e sub-agent both ran against the one isolated Postgres at the same time, and the orchestrator itself had to flag "every number in my report comes from my own *sequential* re-run, not theirs" before the results were trustworthy. If you fan work out across sub-agents against a single shared isolated stack, either serialize whichever steps touch the same DB, or treat any of their self-reported numbers as provisional until re-run one-at-a-time yourself.

## Testing

Three layers, all real (not mocked-everything):

- **Backend unit** (`backend/tests/unit/`) — pytest, no DB/network.
- **Backend integration** (`backend/tests/integration/`) — pytest + httpx against a *live* server (`TEST_API_BASE_URL` env var), real Postgres. The package-level `conftest.py` skips the whole suite cleanly if no live server is reachable — don't fight that, bring the stack up first.
  - If a test file uses the shared `app.db.session.AsyncSessionLocal` engine directly for seeding/cleanup, the pytest run needs a **session-scoped event loop** (`asyncio_default_fixture_loop_scope = "session"` / `asyncio_default_test_loop_scope = "session"` in `pyproject.toml`, already set) — asyncpg connections can't hop event loops, and pytest-asyncio's default is a fresh loop per test.
- **Frontend unit** — Vitest + React Testing Library.
- **E2E** (`e2e/`) — Playwright, real browser, full stack, `E2E_BASE_URL` overridable.

Every FR/NFR traces to a test case in `docs/test-cases/`. When implementing a story, check that doc's coverage for the story ID before considering it done — 100% means every TC for *that story's own scope* has a passing automated test, not that every TC in the file (some belong to other, not-yet-built stories) is green.

**Match a TC's literal wording, not a semantically-adjacent assertion.** A test case that names a specific action (e.g. TC-REQ-004's "add 3 steps, **reorder**") needs a test that actually performs that literal action — an "add steps and edit one field" test doesn't satisfy a TC that also says "reorder," even though both fall under the same general "TestStep CRUD" umbrella. This gap shipped and sat undetected through one full doc-propagation pass before being caught (REQ-2, 2026-09-06) — when auditing coverage, read each TC's `Steps`/`Expected result` cells word-for-word against what the test file actually does, don't pattern-match on the general shape.

**`TestLevel`/`TestType` (and any other global-catalog lookup entity) ship with full CRUD but zero seeded rows** — confirmed empty on `main` itself, not just a freshly-cloned stack (2026-09-06). A fresh manual-test handoff hits this immediately: the `TestCase` create form's level/type dropdowns are empty, blocking the most basic manual walkthrough with no error, just nothing to select. Full CRUD existing is not the same claim as "usable out of the box" — if you're handing an environment to someone for manual testing and the story touches `TestCase` creation at all, seed a handful of rows first (same `docker exec -i <backend-container> python -` pattern as any other hand-seed) rather than assuming the catalog is populated. Whether these ship with a permanent default seed (like RBAC-4 seeds `Role`/`Permission`) is an open product decision for a future story/ADR, not something to silently decide inside a docs or verification pass.

## Architecture decisions are ADR-first

Every stack/architecture choice in this repo has an ADR in `docs/adr/` (MADR-style: Context/Decision/Consequences/Alternatives). Before making or changing one:

1. Check `docs/adr/README.md` — it might already be decided.
2. If you're changing a prior decision (like this file's CoreUI-vs-Tailwind change did to ADR-0009), write a new ADR and mark the old one's status `Partially superseded` / `Superseded`, don't silently edit history.
3. Requirements/WBS/API/Database docs get updated to match whenever an ADR changes something they document — see how ADR-0011 (login rate limiting) propagated across 7 docs in this repo's history for the expected scope of that propagation.

**Not every task is a doc-propagation trigger — check applicability per doc before writing any of them.** Asked to update Requirement/WBS/ADR/Database/API/UI-Design/Sitemap/Test-Plan/Test-Design/Test-Case docs for a local dev-env port fix (gitignored `docker-compose.override.test.yml`, no code/schema/API/UI surface at all), the right call was a doc-by-doc "no ADR was triggered, so none of these apply" table, not writing something into all ten for the sake of completing the list (2026-09-06). Same instinct as the `TestLevel`/`TestType` seeding note above: whether a doc update is warranted is a judgment call to make and state explicitly, not something to do reflexively because a checklist named the doc.

**A UI Design Document's prose and any layout sketch it includes must agree with each other, not just each be internally sensible.** ADR-0032's UI Design Document described a new sub-list as going "directly below" an existing one in its prose, while its own ASCII layout sketch a few lines later showed it above — nobody caught the contradiction at doc-review time, so the implementer had to pick one (documented as an open judgment call in the completion report, not silently absorbed). Cheap to prevent, expensive to leave for later: when a doc pass includes both a prose description and a sketch/diagram of the same layout, read them against each other before considering the doc done, the same word-for-word discipline this file already asks for when auditing TC coverage against a test file.

## Auth & security conventions (ADR-0003, ADR-0011)

- Passwords: argon2 via passlib, explicit cost params, never logged in plaintext anywhere (app logs, tracebacks, request-logging middleware).
- Human login: JWT access token (short-lived) + opaque refresh token, refresh token hash stored server-side (`refresh_token` table, revocable), raw refresh token delivered only via an httpOnly cookie — never in a JSON body.
- Login is rate-limited: 5 failed attempts per `(client_ip, email)` per 15 minutes → 429; resets on a successful login for that pair.
- Unknown email and wrong password return the **identical** generic 401 body — no user-enumeration leak, timing-safe (always run the password-verify code path, real hash or a fixed dummy hash).
- AI agents (`AIAgent`, joined-table-inheritance sibling of `User` under `Actor`) authenticate via a separate long-lived API-key bearer flow, never the human login route.
- **Seeded demo/test accounts must use a real-shaped email domain.** Inserting a `User` row directly (bypassing `POST /auth/signup`'s Pydantic validation) accepts any string in `email`, but `POST /auth/login`'s `EmailStr` validation permanently rejects IANA reserved special-use **TLDs** (`.local`, `.test`, `.invalid`, `.example`) with a `422` — the frontend then shows a generic "check your email and password" message that reads like wrong credentials, not a malformed address. `@example.com` itself is fine (verified against the live validator — only the reserved *TLDs* are blocked, not that specific second-level domain). Bit a real demo handoff, 2026-09-06 (see `backend/CLAUDE.md` for the full story).

## Multi-tenancy (ADR-0007)

Every tenant-scoped table carries a resolvable `org_id` path. Cross-tenant resource access returns **404**, never 403 — existence is never confirmable across an org boundary (NFR-1). Don't add a query that skips the `org_id` filter, generic or bespoke.

**When adding a new bespoke create route for an entity that already has a hand-written resolver** (`app/api/crud_factory.py`'s per-entity `resolve_org_id` functions), check the resolver's branches actually cover the row shape your new route produces — a resolver written before that create path existed has no branch for it, so the row inserts fine and then 404s as "unresolvable" on the very next read. See [ADR-0029](docs/adr/0029-testcase-resolver-direct-link-fallback.md) for the concrete case (REQ-2's direct-link `TestCase`) and `backend/CLAUDE.md` for the general rule. Test with a create-then-immediate-read round trip, not a create-only assertion — the latter cannot catch this class of bug.

## Git / worktrees

Feature work happens in an isolated git worktree (`.claude/worktrees/<name>`), one per story/task, so `main` and other in-flight work stay untouched. Don't `git stash` bare — the stash stack is shared across worktrees; use a WIP commit or a tagged `stash push -u -m "<unique-tag>"` instead.

**A worktree created before a docs-propagation pass finishes on `main` goes stale before implementation even starts.** This repo's own workflow is plan → confirm assumptions → write ADR/Requirements/WBS/etc. (on `main`) → *then* implement (in the worktree, on a later instruction) — but if the worktree was created at planning time (common, since `git worktree add` is one of the first steps), every doc commit that lands on `main` afterward is invisible to it. Confirmed 2026-09-06 (PLAN-3): the implementation worktree branched from a commit predating its own story's ADR/UI-Design-Document/Test-Design/Test-Case updates, so the shipped code referenced docs (`ADR-0033`, PLAN-3's UI Design Document) its own git history doesn't contain, and PLAN-2's screen section wasn't there for the new section to actually sit "directly below" the way the UI doc says — flagged as an open rebase-before-merge item rather than caught early. **Before handing a worktree to an implementation pass, `git log -1` it against the doc commits it's supposed to build on** — if the docs landed after the worktree was created, rebase the worktree onto `main` (or delete and recreate it) first, don't implement against a stale base and fix it at merge time.
