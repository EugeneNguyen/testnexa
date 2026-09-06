/**
 * ADR-0025: generic list/get/create/update/delete calls, parametrized by an
 * `EntityConfig` (`entityConfigs/types.ts`) — the frontend counterpart to
 * the backend's `make_crud_router()`/`CrudEntityConfig` factory
 * (`backend/app/api/crud_factory.py`).
 *
 * Same `apiFetch` conventions as `roleAssignments.ts`/`organizations.ts`:
 * paths are `/api/v1/...` literals passed straight to `apiFetch`, no
 * `credentials`/cookie handling (every route here is `Authorization:
 * Bearer`-gated, `apiFetch` attaches that header itself).
 *
 * Every function is generically typed (`<T>`) rather than importing a
 * concrete summary type per entity — `EntityConfig.fields` plus whatever
 * shape the API actually returns is all a fully generic table/form needs;
 * a fixed `Record<string, unknown>` row type is used throughout by the
 * `crud/` components, sufficient for that.
 */
import { EntityConfig } from "../../entityConfigs/types";
import { apiFetch } from "./client";

export type EntityRow = Record<string, unknown>;

export interface ListEnvelope<T = EntityRow> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  /** Only consulted when the entity config declares `searchFields`. */
  q?: string;
  /**
   * Everything else to put on the query string: the resolved scope
   * field/value (e.g. `project_id=<uuid>`) plus any active `filterFields`
   * values. Falsy values are omitted rather than sent as an empty param.
   */
  params?: Record<string, string | undefined>;
}

/**
 * Fill `:param` placeholders in `template` (e.g. `"/projects/:projectId/releases"`,
 * `entityConfigs/release.ts`'s own `listPath`/`createPath` override) from
 * `routeParams`. A template with no placeholders (the common case) passes
 * through unchanged.
 */
function interpolate(template: string, routeParams: Record<string, string | undefined>): string {
  return template.replace(/:([a-zA-Z]+)/g, (match, key: string) => routeParams[key] ?? match);
}

function buildQueryString(query: ListQuery): string {
  const search = new URLSearchParams();
  if (query.page) {
    search.set("page", String(query.page));
  }
  if (query.pageSize) {
    search.set("page_size", String(query.pageSize));
  }
  if (query.q) {
    search.set("q", query.q);
  }
  for (const [key, value] of Object.entries(query.params ?? {})) {
    if (value) {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * `GET {config.listPath ?? config.path}` — rejects with an `ApiError` if
 * `"list"` isn't in `config.methods` (callers should check that first;
 * `EntityListPage` never calls this otherwise, per each config's own
 * documented "no list route exists" cases: `Organization`, `RoleAssignment`,
 * `TestCase`).
 */
export async function listEntities<T = EntityRow>(
  config: EntityConfig,
  routeParams: Record<string, string | undefined> = {},
  query: ListQuery = {},
): Promise<ListEnvelope<T>> {
  const path = interpolate(config.listPath ?? config.path, routeParams);
  return apiFetch<ListEnvelope<T>>(`/api/v1${path}${buildQueryString(query)}`);
}

/** `GET {config.path}/{id}`. */
export async function getEntity<T = EntityRow>(config: EntityConfig, id: string): Promise<T> {
  return apiFetch<T>(`/api/v1${config.path}/${id}`);
}

/**
 * `POST {config.createPath ?? config.path}`. Rejects with an `ApiError` on
 * `422` (`error.body.field_errors`) same shape as every other write call in
 * this codebase.
 */
export async function createEntity<T = EntityRow>(
  config: EntityConfig,
  routeParams: Record<string, string | undefined>,
  body: Record<string, unknown>,
): Promise<T> {
  const path = interpolate(config.createPath ?? config.path, routeParams);
  return apiFetch<T>(`/api/v1${path}`, { method: "POST", body: JSON.stringify(body) });
}

/** `PATCH {config.path}/{id}`. */
export async function updateEntity<T = EntityRow>(
  config: EntityConfig,
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  return apiFetch<T>(`/api/v1${config.path}/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** `DELETE {config.path}/{id}` — `204 No Content`, `apiFetch<void>` resolves `undefined`. */
export async function deleteEntity(config: EntityConfig, id: string): Promise<void> {
  return apiFetch<void>(`/api/v1${config.path}/${id}`, { method: "DELETE" });
}
