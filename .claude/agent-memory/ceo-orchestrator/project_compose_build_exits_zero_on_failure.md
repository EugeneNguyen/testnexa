---
name: compose-build-exits-zero-on-failure
description: docker compose up --build can exit 0 while the image build actually failed, silently leaving the old backend code running
metadata:
  type: project
---

`docker compose ... up --build -d backend` can **exit 0 even when the image
build failed**, leaving the previously-built container running untouched. Seen
2026-09-06 during PLAN-1: the base-image pull failed with
`failed to solve: python:3.12-slim: ... TLS handshake timeout`, the command
still reported success, and the container kept serving the *old* code — new
route module absent from `/app/app/api/routes/`, new endpoints missing from the
OpenAPI spec.

This compounds the already-documented trap that the backend service has no
source volume mount (`backend/CLAUDE.md`), so the only signal that your edit
took effect is the rebuild — and that signal can lie.

**Why:** the failure looks exactly like "my code doesn't work" rather than "my
code never got deployed", which is a much more expensive thing to debug in the
wrong direction.

**How to apply:** after any backend rebuild in an isolated stack, **verify the
new code is actually live** before running tests against it — don't trust the
exit code. Cheapest checks:
`docker exec <project>-backend-1 ls /app/app/api/routes/<new_module>.py`, or
read the served OpenAPI spec from inside the container
(`urllib.request.urlopen('http://localhost:8000/openapi.json')`) and confirm the
new paths are present. If the build did fail on the base image, `docker pull
python:3.12-slim` first (it succeeded on retry — the timeout was transient),
then rebuild with `--force-recreate`.

Note: inspecting `app.routes` via `docker exec ... python -c` gave misleading
empty output; the served `openapi.json` is the authoritative check. Re-confirmed
2026-09-06 during the PLAN-1 merge-to-main, with the *reason*: this FastAPI
version keeps included routers as `_IncludedRouter` wrapper objects in
`app.routes` instead of flattening them into per-path route entries, so any
`getattr(r, 'path', '')` filter over `app.routes` finds only the 4-5 built-in
paths. Do not read that as a stale image.

Two further refinements from that same pass:

- **A `CACHED` `COPY app ./app` layer is not evidence of a stale build.**
  BuildKit's cache is shared across compose projects on one daemon, so a build
  from a worktree earlier in the session legitimately populates the cache for
  the identical content hash — the main-checkout rebuild then shows `CACHED` and
  is still correct. Verify contents
  (`docker run --rm --entrypoint sh <image> -c 'ls /app/app/...'`) rather than
  inferring staleness from the cache status either way.
- **`openapi.json` is not reachable through nginx on the main stack** —
  `/openapi.json` returns the frontend's `index.html` (200) because nginx routes
  `/*` to the frontend and only `/api/*` to the backend, and there is no
  `/api/openapi.json`. When checking from the host rather than inside the
  container, probe the routes themselves instead: a registered-but-auth-gated
  route returns **401** while a bogus path under the same `/api/v1` prefix
  returns **404** — that 401-vs-404 contrast is a solid liveness proof for new
  routes.
