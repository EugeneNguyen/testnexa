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
import { EntityConfig, LinkCreateAction } from "../../entityConfigs/types";
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
   * ADR-0053 (sort): the field name to sort by, `-`-prefixed for descending
   * (e.g. `"name"` / `"-name"`) — passed straight through to `?sort=` on the
   * generic `list` route (`crud_factory.apply_sort`'s own contract).
   */
  sort?: string;
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
  if (query.sort) {
    search.set("sort", query.sort);
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

/**
 * ADR-0076: substitute a `LinkCreateAction.pathTemplate`'s `{field}`
 * placeholders from a map of the link row's own FK values.
 *
 * Deliberately a **second** interpolator rather than a widened `interpolate`
 * above: that one fills `:param` route placeholders from the current URL's
 * params, and silently leaves an unmatched placeholder in the path (correct
 * there — a template with no placeholders is the common case and a missing
 * route param is a caller bug that shows up as a 404). This one fills `{field}`
 * placeholders from values the caller just collected, and a missing one is a
 * programming error worth failing loudly on rather than POSTing a URL with a
 * literal brace in it. Different brace style, different source, different
 * failure posture — merging them would need a mode flag that no call site
 * would ever pass dynamically.
 */
export function interpolateLinkPath(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z_]+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (!value) {
      throw new Error(`Missing "${key}" for link path ${template}`);
    }
    return value;
  });
}

/**
 * ADR-0076: create one junction/link row through the entity's own bespoke
 * route, declared by its schema's `linkCreate` (`LinkCreateAction`).
 *
 * `values` is keyed by the link row's own FK column names — exactly the shape
 * `relation.scopeField` (the parent) and `relation.targetField` (the picked
 * far row) already give a relationship tab. The route takes no request body:
 * both ids travel in the path, which is why this is not `createEntity` with a
 * different path.
 *
 * Rejects with an `ApiError` carrying the API Document §1 envelope, same as
 * every other write call here — `409` for an already-existing pair, `422` for
 * a cross-project pair, `404` for a cross-tenant one.
 */
export async function createLinkRow(
  action: LinkCreateAction,
  values: Record<string, string>,
): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1${interpolateLinkPath(action.pathTemplate, values)}`, { method: "POST" });
}

/** `DELETE {config.path}/{id}` — `204 No Content`, `apiFetch<void>` resolves `undefined`. */
export async function deleteEntity(config: EntityConfig, id: string): Promise<void> {
  return apiFetch<void>(`/api/v1${config.path}/${id}`, { method: "DELETE" });
}
