# CLAUDE.md — e2e

E2E-specific guidance. Read the repo-root `CLAUDE.md` first (isolated-test-env recipe summary) — this file has the full worked example plus the seed/cleanup script pattern every spec in this directory uses.

## Isolated test environment — full worked example (validated: AUTH-1, REQ-3)

Run from inside the worktree whose branch you're testing, never the main repo root:

```bash
# 1. pick a free 5-digit port
lsof -i :33990 || echo "free"

# 2. docker-compose.override.test.yml, worktree root — !override replaces the
#    ports list instead of appending to it
cat > docker-compose.override.test.yml <<'EOF'
services:
  nginx-dev:
    ports: !override
      - "33990:80"
EOF

# 3. build FROM THE WORKTREE, name the project after the purpose
docker compose -p testnexa-req3-test -f docker-compose.yml -f docker-compose.override.test.yml --profile dev up --build -d

# 4. clone main's DB rather than starting empty
docker exec testnexa-postgres-1 pg_dump -U testnexa -d testnexa -F c -f /tmp/clone.dump
docker cp testnexa-postgres-1:/tmp/clone.dump /tmp/clone.dump
docker cp /tmp/clone.dump testnexa-req3-test-postgres-1:/tmp/clone.dump
docker exec testnexa-req3-test-postgres-1 pg_restore -U testnexa -d testnexa --clean --if-exists /tmp/clone.dump
docker exec testnexa-req3-test-backend-1 alembic upgrade head   # apply whatever migration the branch adds on top

# 5. verify both access paths before trusting anything else
curl http://localhost:33990/api/health
curl http://<lan-ip>:33990/api/health

# 6. tear down when done — removes the cloned DB volume too
docker compose -p testnexa-req3-test down -v
```

Check `docker compose ls` before step 3 for a stale `testnexa-*-test` project nobody tore down — orphans accumulate across sessions and will collide on ports.

## Seed/cleanup script pattern (every spec in this directory follows this)

Specs seed their own fixture via `docker exec -i <backend-container> python -` piping a Python heredoc that uses `app.db.session.AsyncSessionLocal` directly (not the HTTP API — faster, and doesn't depend on the feature under test to set up its own preconditions), printing a single JSON line the spec parses. Cleanup is the same shape in reverse, called from a `finally` block so a failing assertion still cleans up. FK-safe delete order matters: link tables (`app/models/trace.py`) before the rows they link, dependent rows before their parents. See `req1-requirements-ui.spec.ts` or `req3-test-condition-rigor-path.spec.ts` for the exact template — copy one of those rather than writing a new pattern from scratch.

`E2E_BACKEND_CONTAINER` must match whatever compose project you actually started (`<project>-backend-1`) — the default in each spec is whichever project that spec was authored against, not necessarily the one you're running today. Always pass it explicitly when running against a fresh isolated env: `E2E_BASE_URL=http://localhost:<port> E2E_BACKEND_CONTAINER=<project>-backend-1 npx playwright test <spec>`.

## A demo/login account for manual (human) testing is a separate concern from E2E fixtures

E2E specs seed-and-delete their own fixtures per run — there is no persistent account left behind for a human to log in and click around with. If a task asks you to hand the environment to a person to try manually, seed one extra, non-cleaned-up account explicitly for that purpose, and use `example.com`/`example.org` for its email domain (see `backend/CLAUDE.md` — `.local` and other reserved TLDs fail validation and produce a misleading generic login error).
