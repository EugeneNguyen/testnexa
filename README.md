# testnexa

## Development

The full stack (Postgres, backend, frontend, nginx) runs via Docker Compose using the single-port topology described in [ADR-0010](docs/adr/0010-single-port-docker-compose-topology.md). Copy `.env.example` to `.env` (defaults are fine for local dev), then bring the stack up with the `dev` profile:

```
docker compose --profile dev up --build
```

Open `http://localhost:54593` (or the host machine's LAN IP on the same port, e.g. `http://192.168.1.50:54593`) — nginx is the single external entrypoint, routing `/api/*` to the backend and everything else to the Vite dev server (with hot reload via a bind-mounted `frontend/src`). To run a prod-like build instead (static frontend served by nginx), use `docker compose --profile prod up --build`. In both profiles, `postgres-test` starts alongside the stack but sits idle — it's only exercised when the backend's integration test suite is run against it.
