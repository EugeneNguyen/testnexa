# CLAUDE.md — e2e

E2E-specific guidance. Read the root `CLAUDE.md` first (isolated-test-env rule, three-layer testing model). This file is the full worked recipe for standing up an isolated Compose stack and running Playwright against it — distilled from repeated real runs across AUTH-1, REQ-2's implementation, REQ-2's post-merge/manual-verification passes, and REQ-3 (2026-09-05/06).

## Full isolated-stack recipe

1. **Pick a project name and port.** `docker compose ls` first to check nothing stale is already running under a name you're about to reuse — orphans accumulate across sessions and will collide on ports. Project name: `testnexa-<purpose>-<port>` (e.g. `testnexa-verify-55495`). Port: any free 5-digit port (`lsof -i :<port>` to check), bound as `"<port>:80"` (not `"127.0.0.1:<port>:80"`) so it's reachable via both `localhost` and the host's LAN IP — Compose's plain `"<port>:80"` shorthand already binds `0.0.0.0`, no extra config needed for that half.

2. **`docker-compose.override.test.yml`** in the worktree root (already gitignored, `.gitignore:7` — don't fight that, don't try to commit it):

   ```yaml
   services:
     nginx-dev:
       ports: !override
         - "<port>:80"
     postgres:
       ports: !override        # only needed if backend/tests/integration/*.py will run
         - "<db-port>:5432"    # against this stack from the host (see backend/CLAUDE.md)
       volumes: !override
         - <project>_postgres_data:/var/lib/postgresql/data
   volumes:
     <project>_postgres_data:
   ```

   The `!override` tag is not optional — Compose's default merge behavior for a list key like `ports`/`volumes` is to **append**, not replace; omit the tag and you'll get both the original and new port bound, and the original (main's `54593`) will still be a live conflict if you're also trying to rebind that same service. This has bitten more than one session — always watch the `up` output for a "port already allocated" error and fix the tag if you see one.

3. **Bring it up:** `docker compose -p <project> -f docker-compose.yml -f docker-compose.override.test.yml --profile dev up -d --build` from the worktree root (build context must be the worktree, not the main repo root, or the isolated stack won't contain the branch's code).

4. **Clone main's DB**, don't start empty:
   ```
   docker exec testnexa-postgres-1 pg_dump -U testnexa -d testnexa --no-owner --no-privileges \
     | docker exec -i <project>-postgres-1 psql -U testnexa -d testnexa
   ```
   (equivalently, `pg_dump -F c -f /tmp/clone.dump` + `docker cp` + `pg_restore --clean --if-exists`, same result). Verify with a row-count spot-check on a couple of tables (`organization`, `project`) — main vs. clone — not just "the command exited 0."

5. **Migrate:** `docker exec <project>-backend-1 alembic upgrade head` — a no-op if main was already at head (expected, since main is what any feature branch merges from), but always run it and check `alembic heads` shows exactly one head.

6. **Health-check both IPs:** `curl http://localhost:<port>/api/health` **and** `curl http://<lan-ip>:<port>/api/health` (get the LAN IP via `ipconfig getifaddr en0` on macOS) — both must return `{"status":"ok"}`. This is the actual proof the "both IP" requirement is satisfied, not just that the port bound.

7. **Tear down when done:** `docker compose -p <project> -f docker-compose.yml -f docker-compose.override.test.yml --profile dev down -v` (removes containers, network, and the cloned DB volume), then delete the worktree-local `docker-compose.override.test.yml` and any `.env` you created for the stack (check `git status --short` after — neither should show as untracked cruft left behind; `.env` is *not* currently in `.gitignore`, unlike the override file, so don't forget it manually).

## Known, harmless failures when testing through this topology

`nginx/nginx.dev.conf` only proxies `/api/health` and `/api/*` to the backend — bare `/health` falls through to the frontend's catch-all `index.html`. If `TEST_API_BASE_URL` points at the isolated stack's **nginx** port (rather than the backend directly), `backend/tests/integration/test_health_api.py::test_health_returns_ok_over_real_http` and `test_rbac_seed.py::test_live_server_health_check_still_ok_after_rbac_seed_migration` will fail — both call bare `/health` on purpose (matching the direct-backend-port default). This is a topology artifact, not a regression; don't chase it, just note it in your report.

**Separately, don't append `/api` to `TEST_API_BASE_URL` itself** when pointing it at this stack's nginx port — `backend/CLAUDE.md` has the full write-up (a REQ-4 verification pass lost real time to this exact mistake, 2026-09-06). The `/health`-only artifact above is about which *path* two specific tests hit; this one is about the *base URL* every other integration test's path gets built on top of, and getting it wrong breaks far more than two tests.

## Seed/cleanup script pattern (used by every `req*-ui.spec.ts` file)

Each UI-level spec seeds its own fixture via `docker exec -i <backend-container> python -` with a heredoc Python script (direct `AsyncSessionLocal` inserts — `User`/`Organization`/`OrgMembership`/`RoleAssignment`/`Project`, printing a JSON blob of the ids it created to stdout), and cleans up the same way in a `finally` block with a matching FK-safe (child-first) delete script taking those ids as `sys.argv`. FK-safe delete order matters: link tables (`app/models/trace.py`) before the rows they link, dependent rows before their parents. See `req1-requirements-ui.spec.ts` or `req3-test-condition-rigor-path.spec.ts` for the canonical shape — copy one of those rather than writing a new pattern from scratch. `E2E_BACKEND_CONTAINER` (env var, defaults to a specific prior session's container name — always override it to whatever isolated stack you're actually running against, `<project>-backend-1`) is how these scripts find the right container: `E2E_BASE_URL=http://localhost:<port> E2E_BACKEND_CONTAINER=<project>-backend-1 npx playwright test <spec>`.

**If you hand-seed an account meant for a human to actually log in with** (not just a Playwright fixture) — e.g. handing the environment to a person to try manually — seed one extra, non-cleaned-up account explicitly for that purpose, and see `backend/CLAUDE.md`'s email-domain gotcha: don't use `.local`/`.test`/`.invalid`/`.example`, use `example.com`/`example.org` instead. **Construct it as `User(name=..., email=..., password_hash=...)` directly, never `Actor()` then `User(actor_id=actor.id, ...)`** — see `backend/CLAUDE.md`'s joined-table-inheritance note, same trap either way you're hand-seeding a `User`.

## Running the full suite (not one spec) against a stack needs BOTH container-name overrides, not just `E2E_BACKEND_CONTAINER`

A second env var, `E2E_POSTGRES_CONTAINER`, exists for the same reason and defaults the same broken way — `auth-refresh.spec.ts` (and any spec that revokes/mutates rows directly via `docker exec ... psql`, not just the seed-script pattern above) reads it separately, also defaulting to a specific prior session's container name. Running `npx playwright test` (no filter, every spec) against a stack without overriding **both** produces a wall of `Error response from daemon: No such container: testnexa-<other-story>-backend-1` failures — 20+ specs at once, since nearly every spec file has its own stale default. **This looks exactly like a broken environment, but it isn't one** — same "suspect harness config before the code under test" instinct `backend/CLAUDE.md`'s `/api`-prefix note already teaches, just at the container-name layer instead of the URL layer: `grep -rn "BACKEND_CONTAINER\s*=\|POSTGRES_CONTAINER\s*=" e2e/tests/*.spec.ts` to see every default in one pass, then run with both overrides set: `E2E_BASE_URL=http://localhost:<port> E2E_BACKEND_CONTAINER=<project>-backend-1 E2E_POSTGRES_CONTAINER=<project>-postgres-1 npx playwright test`. Confirmed 2026-09-06: 26 false failures with no overrides → 3 real/pre-existing ones with both set.

## `auth-login.spec.ts` is permanently broken against a DB cloned from `main`, by design gap not regression

Unlike every other spec in this directory, `auth-login.spec.ts` does **not** self-seed its fixture — its own header comment says the account (`e2e-auth1@example.com` by default, `E2E_LOGIN_EMAIL`/`E2E_LOGIN_PASSWORD` overridable) is "seeded directly into the target environment's DB... see the AUTH-1 test-env handoff for credentials." That account was seeded only into AUTH-1's own now-torn-down isolated stack — it was never persisted to `main`, so a fresh isolated stack cloned from `main` (this directory's own documented recipe, above) will never have it. Confirmed by direct query 2026-09-06 (`SELECT email FROM "user" WHERE email = 'e2e-auth1@example.com'` → zero rows on a `main`-cloned DB). **Don't chase this as a regression** — either seed that exact account yourself first (same pattern as the hand-seed note above) or skip the spec. Worth fixing properly some day by converting it to the same self-seeding pattern every other spec already uses, so it doesn't require an undocumented, one-off manual precondition — flagged here, not fixed, since that's a real code change outside a docs-only pass.

## Run `--workers=1` when exercising more than one or two specs together

This repo's specs are written to run in real browsers against a single dev-mode stack (one Vite process, one uvicorn process) — `playwright.config.ts`'s `fullyParallel: true` default is fine for a single spec, but multiple specs/workers hammering that same single-process stack concurrently produces real flakiness (`page.goto` timeouts, slow `expect` timeouts) that has nothing to do with the code under test. Confirmed repeatedly: the exact same spec set that flakes under default parallelism passes reliably at `--workers=1`. If a test fails once under any multi-worker run, **rerun it alone** before concluding it's a real bug — this session hit that exact false-positive-then-clean-rerun pattern more than once.
