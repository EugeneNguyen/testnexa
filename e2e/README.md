# TestNexa E2E tests

Playwright smoke test proving the full stack (nginx + frontend + backend)
wires together end to end. This is a scaffold-stage smoke test, not a
feature test suite — no business features exist yet.

## Prerequisites

The stack must already be running (e.g. via Docker Compose) before running
these tests:

```bash
docker compose --profile dev up --build
```

## Run

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
npx playwright test
```

By default the tests target `http://localhost:54593` (the nginx dev
profile's exposed host port). Override with `E2E_BASE_URL` to point at a
different host/port:

```bash
E2E_BASE_URL=http://localhost:54593 npx playwright test
```
