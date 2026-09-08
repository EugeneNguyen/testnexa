---
name: integration-suite-cold-probe-skip
description: The integration conftest's 2s /health probe can spuriously skip the ENTIRE backend suite against a freshly-started stack — reported as "skipped", not "failed"
metadata:
  type: project
---

`backend/tests/integration/conftest.py`'s session-scoped `_require_live_server`
guard probes `{TEST_API_BASE_URL}/health` with a hard-coded
`_PROBE_TIMEOUT_SECONDS = 2.0`. Against an nginx-fronted isolated stack, bare
`/health` is **not** proxied to the backend — it falls through to the Vite dev
server's catch-all `index.html`. On a container that has just started, Vite's
first request can take longer than 2s to compile and answer, so the probe times
out and pytest reports the whole module as **`skipped`**, not failed.

Confirmed 2026-09-07 (EXEC-1): an identical `pytest` invocation reported
`2 skipped` and then, moments later with no code or env change, `2 passed`. The
only difference was that a `curl` had warmed Vite in between.

**Why this matters:** a skip reads as "nothing to run here," not as a problem —
so a run that silently exercised *zero* tests can be mistaken for a clean one.
That is a strictly worse failure mode than a red test, and it is invisible in a
`-q` summary line unless you actually read the counts. It is the same
"suspect the harness before the code" family as `backend/CLAUDE.md`'s
`/api`-double-prefix and missing-`DATABASE_URL` notes, but it fails *silently
green* rather than loudly red.

**How to apply:** after bringing up an isolated stack, `curl` both
`http://localhost:<port>/health` and `/api/health` once before the first pytest
run. If any integration run comes back `skipped`, re-run it before concluding
anything — do not treat a skip as a pass, and always report the real
passed/skipped/failed counts rather than "green". Related: [[known-red-e2e-specs]].
