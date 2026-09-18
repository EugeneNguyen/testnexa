# 0092. A relationship tab's table gets sort, Filter, and the Columns picker — the same `EntityTable` capability a standalone list page has

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-18
**Related:** [ADR-0074](0074-entity-detail-relationship-tabs.md) (introduces `EntityRelationTab` + `EntityTable`'s `bare` prop), [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) (backend-driven schema, incl. sort — `entity-table.tsx`'s own comments cite this as "ADR-0053," a pre-existing drift in the source not corrected here), [ADR-0071](0071-entity-table-column-preferences.md) (Columns picker), [ADR-0072](0072-entity-table-filter-modal.md) (Filter modal)

## Context

CTO report: `/projects/{id}/admin/test-suites/{id}?tab=test-suite-test-cases` (any relationship tab on `EntityDetailPage`) should have the same CRUD-entity table capability a standalone admin list page has — sort, show/hide/reorder columns, filter.

Investigation found `EntityRelationTab` already renders the real `EntityTable` (not a hand-rolled table) — it gets pagination, FK-resolved cells, badges, and date formatting "for free," exactly as ADR-0074 intended. The gap was narrower than it first looked: `EntityTable`'s `bare` prop (ADR-0074's Amendment, the mode `EntityRelationTab` uses so it doesn't paint a second card inside `EntityDetailPage`'s own card) returned only the table's `sections` — no `Card.Header`, and therefore no Columns button, no Filter button, no search box, regardless of any other prop. Sort was a narrower, second gap: `EntityTable`'s click-to-sort header logic already runs inside `sections` (so it *was* live in `bare` mode), but `EntityRelationTab` never passed `sortField`/`sortDir`/`onSortChange` at all, and held no local sort state.

`FieldConfig.sortable`/`filterable` and `EntityConfig.filterFields` already arrive schema-driven on the exact `config` object `EntityRelationTab` fetches (`useEntitySchema(relation.entity)`) — no backend work was needed to make sort/filter meaningful on that config's own fields.

## Decision

**`EntityTable`:** extracted the Columns/Filter/search controls (previously only ever assembled inline inside the non-`bare` `Card.Header`) into one `toolbarControls` JSX value, and the two modals (`ColumnPreferencesModal`, `FilterModal`) into one `modals` value, both computed unconditionally — `bare` and non-`bare` now share the identical controls/modals, differing only in whether they sit inside a `Card`/`Card.Header`/`Card.Title` or a plain toolbar `<div>` above `sections`. `bare` still renders no `title` (a `bare` caller has nowhere to put one) — everything else that was `Card`-shaped by accident of layout, not by requirement, is now available regardless of `bare`.

**`EntityRelationTab`:** added local `sort`/`filters` state (component-owned, same posture and same click-to-sort toggle machinery `EntityListPage.handleSortChange` already has), threaded into `listQuery`'s `queryKey`/`queryFn` (`sort` param, `params: {...filters, [scopeField]: parentId}` — scope last, so a filter value can never shadow the actual scope binding), and passed to `EntityTable` as `sortField`/`sortDir`/`onSortChange`/`filters`/`onFiltersChange`. Both reset to `null`/`{}` whenever `relation.entity` changes, since `EntityRelationTab` is not remounted on tab switch (`EntityDetailPage` renders it with no `key`) — without the reset, a sort or filter chosen on one tab would silently keep narrowing the next tab's query. Column visibility/order needed no equivalent reset: `EntityTable` already keys its own `localStorage` preference by `config.resource`, which changes with `relation.entity` on its own.

The sort/filter/columns are scoped to the config **currently** rendered — the link entity's own fields (e.g. `test_suite_test_case`'s `test_case_id`/`created_at`) for a many-to-many tab, not the far entity's (`TestCase`'s own `title`/`priority`/`status`/...). Merging the far entity's fields onto the rendered rows (what a user probably means by "sort test cases by priority" on this specific tab) would need the backend's list route for the relation to return far-entity fields, a materially larger, separate change — **named here as an explicit, deliberate exclusion**, not silently out of scope.

## Consequences

- Every relationship tab on `EntityDetailPage` now has a working Columns button, Filter button (when the rendered config declares `filterFields`), and sortable column headers (when the rendered config's fields don't set `sortable: false`) — the identical `EntityTable` capability a standalone `EntityListPage` already has.
- No backend change, no schema change, no migration — `sortable`/`filterable`/`filterFields` were already served.
- `EntityTable`'s own `bare` prop doc comment corrected in place (it previously said search/Columns/Filter don't render in `bare` mode — no longer true).
- New Vitest file `EntityDetailPage.relationSortFilterColumns.test.tsx` (3 tests): Columns button renders in a bare relation tab; the Filter button renders and applying a filter re-queries with the new param; clicking a sortable header toggles asc → desc and re-queries with `?sort=`/`?sort=-field`.
- `tsc --noEmit` clean; full Vitest suite 798/798 (795 pre-existing + 3 new), zero regressions — every existing `bare`-mode assertion (`entity-table.test.tsx`'s own `bare (ADR-0074)` suite, `EntityDetailPage.tabs.test.tsx` and siblings) still passes unmodified, since none of them asserted the *absence* of Columns/Filter as their claim.
- **Explicit exclusion, stated rather than silently deferred**: sort/filter/columns operate on the *link* entity's own (often sparse) fields for a many-to-many tab, not the far entity's richer field set. Closing that gap is a separate, larger change (a backend list-route change to merge far-entity fields onto each row) and is not part of this ADR.

## Alternatives considered

- **Give `EntityRelationTab` its own hand-rolled Columns/Filter buttons instead of extending `EntityTable`.** Rejected — this repo's own "check for an existing reusable primitive before hand-rolling" convention (`frontend/CLAUDE.md`) applies directly here: the capability already exists in `EntityTable`, gated only by an accident of the `bare` prop's original implementation (it returned early, before ever reaching the controls), not by any real difference in what a relation tab's table needs versus a standalone list's.
- **Merge far-entity fields onto the rendered rows now, to get "real" sort/filter over `TestCase`'s own columns.** Rejected for this pass — a materially bigger, cross-cutting backend change (the link entity's own list route, or `derive_entity_relations`, would need to know how to join and expose the far entity's fields), named explicitly above as future work rather than folded in silently.
