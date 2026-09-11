# ADR-0056: ADMIN-4 column sort for the generic admin CRUD list

**Status:** Accepted
**Date:** 2026-09-11
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD router factory this ADR extends — `list_items`, `apply_filters_and_search`, `clamp_pagination`), [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) (backend-driven entity schema — `derive_entity_schema`, `GET /entities/{resource}/schema`, the single source of truth this ADR's `sortable` flag is served through), [ADR-0041](0041-ds-2-table-container-shared-pagination.md) (shared `Table` container this ADR's frontend half sits on top of, page/pageSize state pattern).

## Context

`crud_factory.py`'s generic `list` route (ADR-0022) had no sort support at all — confirmed by grep before starting (no `order_by`/`sort` reference anywhere in the file). Every one of the 24 generic-admin-CRUD list screens rendered rows in whatever order the database happened to return them (insertion order in practice, never a documented contract). The CTO asked for column sort directly ("apply sort to frontend" → clarified to "both frontend and backend"), matching this repo's own generic-CRUD-surface pattern of adding capabilities to the factory once (ADR-0041's shared pagination is the precedent) rather than per-screen.

## Decision

**Backend** — `crud_factory.py`:
- `FieldMeta.sortable: bool = True`, same auto-derive-unless-overridden posture as `show_in_table`. Serialized as `"sortable"` on every field entry `GET /entities/{resource}/schema` (ADR-0055) already returns — no second, independently-maintained list of which columns are sortable.
- `apply_sort(query, model, sort_param, sortable_fields)`: pure query-builder (same testability posture as `apply_filters_and_search`). `?sort=<field>` → ascending, `?sort=-<field>` → descending, absent → unchanged (today's pre-sort order, no behavior change for existing callers). An unknown or explicitly-`sortable=False` field name never reaches `getattr(model, ...)` — it 422s (`{"sort": ["'<field>' is not a sortable field"]}`), the same shape every other malformed-list-query-param case in this route already 422s with (missing/ambiguous scope, unparsable scope UUID).
- `sortable_fields` is computed once per entity, at router-build time, **from that entity's own `derive_entity_schema(config)`** — the same function the schema route serves — not a second hand-kept set. This is deliberate: the whole point of ADR-0055 was closing exactly this class of "two independently-maintained descriptions of the same entity" drift; a sort allow-list that could silently disagree with what the schema advertises as sortable would reopen it one field at a time.
- `Release` (the one entity with no `CrudEntityConfig`, ADR-0055) gets `sortable: false` on all 3 of its static frontend fields — its list route is 100% bespoke, never routes through `apply_sort` at all.

**Frontend**:
- `EntityTable`: a `field.sortable !== false` column header renders as a button (not bare text) when the caller passes `onSortChange`, with a `fa-sort`/`fa-sort-up`/`fa-sort-down` glyph reflecting current state. Sort *state* is not this component's — same split ADR-0041 already drew for `page`/`pageSize`.
- `EntityListPage`: owns the click-to-sort toggle (unsorted → ascending → descending → unsorted, clicking a different column always restarts at ascending), resets to page 1 on every sort change (a sort change is a new result set, not a new page of the old one — same posture as a filter/search change), and turns the state into the `sort` query param `listEntities` puts on the wire.

**Not done this pass**: multi-column sort, a server-driven "default sort" per entity, persisting sort choice across navigation — none were asked for; `sort` state is component-local, same lifetime as `page`/`pageSize`/`filters`.

## Alternatives considered

- **Client-side sort of the already-fetched page** (the pattern `OrgHome`'s own Project table still uses, ADR-0039) — rejected: it only sorts the current page's rows, not the full result set, which is actively misleading once pagination is involved (a "sorted" list where page 2 isn't actually adjacent to page 1 in sort order). Backend-driven `ORDER BY` was the explicit ask ("both frontend and backend").
- **A separate `sortableFields: string[]` array on the schema response**, rather than a per-field `sortable` flag — rejected: every other per-field capability this schema already advertises (`showInTable`, `required`, `readOnly`) is a flag on the field entry itself, not a parallel array a consumer has to cross-reference; consistency with the existing shape.
- **Naming-convention field-name validation instead of the allow-list** (accept any `snake_case`-looking string, let the DB error if the column doesn't exist) — rejected on the same grounds ADR-0055 rejected naming-convention FK inference: a wrong guess fails in a confusing way (a raw SQLAlchemy `AttributeError` surfacing as a 500) rather than a clean 422, and it would let a caller sort on a column that exists on the model but was never meant to be exposed (an internal bookkeeping field with no corresponding schema entry at all).

## Consequences

- Every one of the 24 generic-admin-CRUD list screens gains sort for free, no per-screen wiring — the same "add it to the factory once" leverage ADR-0041's shared pagination already demonstrated.
- `Release`'s admin screen (the one static-config exception) does not get sort — a real, accepted gap, not an oversight; fixing it needs `Release`'s own bespoke list route to grow `?sort=` support, out of scope for this pass.
- The `sortable_fields` allow-list is computed from `derive_entity_schema` at **router-build time** (process startup), not per-request — a config change to `FieldMeta.sortable` takes effect on the next backend restart/redeploy, same lifetime as every other `CrudEntityConfig` declaration in this factory.
