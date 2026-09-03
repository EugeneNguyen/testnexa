# TestNexa Frontend

Codebase skeleton only (per the project scaffold task) — Vite + React Router +
TanStack Query + React Hook Form + Zod + Tailwind CSS (ADR-0009). The only
screen implemented is a scaffold-verification page at `/` that checks
`/api/health` to prove frontend<->backend wiring. Bespoke workflow screens,
generic CRUD, and auth flow are deferred to a later task.

## Dev setup

```bash
npm install
cp .env.example .env   # optional for local non-compose dev; see below
npm run dev
```

The dev server listens on `http://localhost:5173` (bound to `0.0.0.0`, so it's
also reachable via your LAN IP).

## API base URL

- **Local, non-compose dev:** set `VITE_API_BASE_URL` (see `.env.example`) to
  point at wherever the backend is running, e.g. `http://localhost:8000`.
- **Docker Compose (dev or prod profile):** leave `VITE_API_BASE_URL` unset.
  nginx routes `/api/*` to the backend, so the frontend calls same-origin
  `/api/...` (ADR-0010).

## Testing

```bash
npm run test        # Vitest + React Testing Library
npm run typecheck   # tsc --noEmit
```

## Build

```bash
npm run build        # outputs static assets to dist/
npm run preview       # preview the production build locally
```

## Docker

The `Dockerfile` has two targets:

- `docker build --target dev` — dev profile, runs the Vite dev server.
- `docker build --target build` — prod profile, produces `/app/dist` for
  nginx to serve statically.
