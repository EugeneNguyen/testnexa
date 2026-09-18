/**
 * `components/organisms/` (ADR-0043, superseding ADR-0023's `components/crud/`
 * location). UI Design Document §2/§3: a table with
 * one column per `fields[]` entry (`showInTable !== false`), a filter row
 * for `filterFields`, a `?q=` search box when `searchFields` is non-empty,
 * pagination, and a trailing actions column whose Edit/Delete icons are
 * present only when both (a) the config's own `methods` include
 * `"update"`/`"delete"` and (b) the caller's per-row permission callback
 * allows it (§5 — absent, not disabled, either way: a `methods` gap is a
 * structural read-only entity, a permission gap is per-row).
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** the markup is raw Bootstrap 5 now.
 * `CTable*` -> `<tr>`/`<th scope="col">`/`<td>` (which is also the shape
 * `container/Table.tsx`'s `columns`/`renderRow` props take since ADR-0042),
 * `CBadge` -> `<span class="badge bg-*">` (**`bg-*`, not Bootstrap 5.3's
 * newer `text-bg-*`** — `bg-*` is what `CBadge` actually rendered and what
 * the rest of the codebase's badge assertions check; see the root
 * `CLAUDE.md`'s ADR-0042 gotcha list), `CButton` -> `<button
 * class="btn btn-outline-* btn-sm">`, `CFormInput` -> `<input
 * class="form-control">`, `CAlert` -> `<div class="alert alert-danger"
 * role="alert">`, `CSpinner` -> `<div class="spinner-border">`. The
 * Edit/Delete icons were `@coreui/icons`' `cilPencil`/`cilTrash` via `CIcon`;
 * they are Font Awesome `fa-solid fa-pencil` / `fa-solid fa-trash` `<i>`
 * elements now. `aria-label="Edit"`/`"Delete"` on the buttons is unchanged —
 * it is what the icons' accessible name has always come from, and what the
 * tests look them up by.
 *
 * FK cells resolve via a batched, deduped lookup (one `getEntity` per
 * *distinct* id across the current page, not one per row) — §3's own "not
 * one request per row" requirement.
 *
 * **DS-2 (ADR-0041):** the table markup, `CPagination` block, and the new
 * "Rows per page" selector all live in `container/Table.tsx` now — this
 * component keeps its `EntityConfig`-driven column/cell/actions system and
 * its search/filter row (both of which the container has no opinion on) and
 * delegates the rest. The external prop contract is unchanged except for one
 * added optional `onPageSizeChange`, so all 24 generic-admin entity list
 * screens' existing assertions pass unmodified (TC-DS-016). ADR-0041
 * explicitly declines to merge `EntityConfig`-driven columns with the
 * container's generic render-prop API — they stay two call conventions over
 * one shared pagination implementation.
 *
 * **ADR-0053 (backend-driven entity schema):** two things this component used
 * to own itself now arrive with the config.
 *
 * 1. FK label resolution reads its ref-entity configs from
 *    `useEntitySchemas([...])` — called **once, at the top**, over every
 *    distinct `refEntity` on the config — instead of the old per-field
 *    `entityConfigByKey[field.refEntity]` registry lookup (that map no longer
 *    exists). A hook can't be called per-field inside the effect/`renderCell`
 *    callback, which is exactly the shape `useEntitySchemas` (the batch
 *    sibling of `useEntitySchema`) exists for.
 * 2. Enum badge colours come from `field.badgeColors` (backend-served, already
 *    filtered to that field's own `values`), replacing the module-level
 *    `ENUM_BADGE_COLORS` constant this file used to carry. The plain-grey
 *    `"secondary"` fallback stays — an enum with no semantic colouring at all
 *    (`EntryExitCriteria.type`, `TestLog.event_type`) is served with no
 *    `badgeColors` key at all and must keep rendering exactly as before.
 *
 * **ADR-0053 (sort):** a `field.sortable !== false` column header renders as a
 * button (not a bare `<th>`) whenever the caller passes `onSortChange` — this
 * component owns only the click affordance and the current-sort glyph
 * (`fa-sort`/`fa-sort-up`/`fa-sort-down`); the sort *state* (which field, which
 * direction) and the resulting `?sort=` query param are `EntityListPage`'s,
 * same split as `page`/`pageSize`.
 *
 * **[ADR-0073](../../../../../docs/adr/0073-generic-entity-detail-page.md):**
 * two changes, both additive.
 *
 * 1. **`onRowClick`** — an optional callback making each `<tr>` a clickable,
 *    keyboard-reachable navigation affordance. Same split as sort/pagination:
 *    this component owns the affordance (cursor, `tabIndex`, Enter/Space
 *    parity, and the Actions cell's `stopPropagation` so Edit/Delete stay
 *    independent), `EntityListPage` owns *where* the click goes. Omitting the
 *    prop reproduces the pre-ADR-0073 `<tr>` byte-for-byte.
 * 2. **Cell rendering and fk-label resolution moved out**, to
 *    `components/molecules/entity-field-value` and
 *    `pages/admin/useFkLabels` respectively, so `EntityDetailPage` renders
 *    the identical value formatting without a second copy. A pure reuse
 *    extraction — no rendered-output change, no new decision of its own (see
 *    `frontend/CLAUDE.md`'s "this is a reuse check, not a new ADR" rule; the
 *    ADR exists for the detail *page*, not for this move).
 *
 * **ADR-0071 (COLPREF-1, column visibility + order):** the rendered column
 * list is no longer `config.fields.filter(showInTable !== false)` directly —
 * it is that set merged with a per-entity `localStorage` preference
 * (`lib/columnPreferences.ts`), editable through the new "Columns" header
 * button + `ColumnPreferencesModal`.
 *
 * Unlike sort/page/pageSize/filters/search above, this state is **owned here,
 * not by `EntityListPage`** — and that asymmetry is deliberate. Each of those
 * five maps to a backend query parameter, so it belongs to whoever owns the
 * list query. Column visibility and order map to nothing server-side: they
 * change only what this component paints. Keeping the state here means every
 * `EntityTable` caller, present and future, gets the capability with zero
 * prop plumbing (`EntityListPage` needed no change at all for this story).
 * In-repo precedent for a component owning its own persisted presentation
 * state: `AppHeader`'s colour-mode toggle.
 */
import { KeyboardEvent, ReactNode, useMemo, useState } from "react";
import Table from "../../../container/Table";
import { EntityConfig, FieldConfig } from "../../../entityConfigs/types";
import { EntityRow } from "../../../lib/api/entityCrud";
import {
  applyColumnPreferences,
  clearColumnPreferences,
  ColumnPreferences,
  defaultTableFields,
  loadColumnPreferences,
  lockedFieldNames,
  saveColumnPreferences,
  toPreferenceRows,
} from "../../../lib/columnPreferences";
import { activeFilterCount, filterableFields } from "../../../lib/entityFilters";
import { useFkLabels } from "../../../pages/admin/useFkLabels";
import { Alert } from "../../atoms/alert/alert";
import { Button } from "../../atoms/button/button";
import { Card } from "../../atoms/card/card";
import { Icon } from "../../atoms/icon/icon";
import { Spinner } from "../../atoms/spinner/spinner";
import { TextInput } from "../../atoms/text-input/text-input";
import { renderEntityFieldValue } from "../../molecules/entity-field-value";
import { ColumnPreferencesModal } from "../column-preferences-modal";
import { FilterModal } from "../filter-modal";

export interface EntityTableProps {
  /**
   * AdminLTE "full-width table" card pattern: rendered as the card's own
   * `.card-title`, in `.card-header`. Optional so `EntityTable.test.tsx`'s
   * existing fixtures (no title needed for the shared-logic tests) keep
   * compiling unchanged — `EntityListPage` is the one caller that passes it.
   */
  title?: ReactNode;
  /**
   * Rendered in `.card-header .card-tools`, alongside the search box (if
   * any) — `EntityListPage`'s permission-gated "New" button lives here now,
   * not owned by this component (it has no create-permission/modal-state
   * concerns of its own).
   */
  headerActions?: ReactNode;
  config: EntityConfig;
  rows: EntityRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /**
   * DS-2: fired when the user picks a different page size in the shared
   * container's "Rows per page" selector. Optional so the 9 existing
   * `EntityTable.test.tsx` cases (and any other caller) keep compiling
   * unchanged — `EntityListPage` is the one caller that passes it.
   */
  onPageSizeChange?: (pageSize: number) => void;
  /**
   * ADR-0053 (sort). `sortField`/`sortDir` describe the list's current sort
   * (owned by `EntityListPage`, same posture as `page`/`pageSize`);
   * `onSortChange`, if given, makes every `field.sortable !== false` column
   * header a clickable sort toggle. Optional so the existing
   * `EntityTable.test.tsx` fixtures (no sort needed for the shared-logic
   * tests) keep compiling unchanged.
   */
  sortField?: string;
  sortDir?: "asc" | "desc";
  onSortChange?: (field: string) => void;
  loading?: boolean;
  loadError?: string | null;
  /**
   * ADR-0072 (filters). The list's currently-applied exact-match filters —
   * owned by `EntityListPage`, same posture as `page`/`pageSize`/`sort`/
   * `search`, and for the same reason: each of these maps to a backend query
   * parameter, so it belongs to whoever owns the list query. (Contrast column
   * visibility/order, which maps to nothing server-side.)
   *
   * `onFiltersChange`, if given, renders the "Filter" header button and its
   * `FilterModal`. Optional so the existing `entity-table.test.tsx` fixtures
   * keep compiling unchanged.
   *
   * This replaces a `onFilterChange?: (field, value) => void` prop that was
   * declared here but never destructured or rendered — dead since an earlier
   * refactor dropped the per-column filter row. `EntityListPage`'s `filters`
   * state and its `params: {...filters}` list-query wiring were live the
   * whole time; only the UI was missing. The signature changes to a whole-map
   * setter because Apply commits several conditions at once.
   */
  filters?: Record<string, string>;
  onFiltersChange?: (filters: Record<string, string>) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  canEditRow?: (row: EntityRow) => boolean;
  canDeleteRow?: (row: EntityRow) => boolean;
  onEdit?: (row: EntityRow) => void;
  onDelete?: (row: EntityRow) => void;
  /**
   * [ADR-0077](../../../../../docs/adr/0077-relationship-tab-unlink-action.md):
   * a per-row **Remove** action, for a table whose rows are ADR-0005 link rows
   * rather than records — `EntityRelationTab`'s many-to-many tab is the one
   * caller.
   *
   * A third prop rather than reusing `onDelete`, because the two gate on
   * genuinely different facts and collapsing them would require lying about
   * one of them:
   *
   * - `onDelete` is gated on `config.methods.includes("delete")` — "the
   *   generic factory serves `DELETE /{resource}/{id}`". For a link entity
   *   that is **false and must stay false**: a link row has no addressable id
   *   of its own on the generic surface, and flipping the flag to reuse the
   *   existing button would make every *other* consumer of that config (the
   *   entity's own list page included) offer a row delete that `405`s.
   * - `onUnlink` is gated on the prop's presence alone. Whether the capability
   *   exists is `config.linkDelete`, and whether this actor may use it is that
   *   declaration's own permission — both questions the caller has already
   *   answered before it passes the handler, neither of them derivable here.
   *
   * It also renders with `aria-label="Remove"`, not "Delete", which is the
   * accurate word: the far record survives, only the assertion that the two
   * relate goes away.
   */
  onUnlink?: (row: EntityRow) => void;
  /**
   * ADR-0073: clicking anywhere on a row that isn't an action control fires
   * this. Optional — omit it and every `<tr>` renders exactly as it did
   * before (no `cursor: pointer`, no `tabIndex`, no handlers), so the 9
   * pre-existing `entity-table.test.tsx` fixtures and every non-admin caller
   * are unaffected. `EntityListPage` is the one caller that passes it.
   *
   * The trailing Actions cell stops propagation, so Edit/Delete keep working
   * as their own independent affordances (TC-ADMIN-061) — that is the one
   * piece of "don't navigate" knowledge this component owns; everything
   * about *where* a row click goes is the caller's.
   */
  onRowClick?: (row: EntityRow) => void;
  /**
   * ADR-0074 (Amendment): render the `.card-body` sections **without** the
   * surrounding `.card`/`.card-header`, for a caller that already owns a card
   * — `EntityDetailPage`'s relationship tab pane, which lives inside one card
   * whose header is the tab strip itself (Tabler's documented "tabs in the
   * card header" pattern). Nesting this component's own card inside that
   * card's body would paint a second border/shadow around the table and
   * repeat the tab's label as a card title.
   *
   * **ADR-0092:** `bare` still skips `Card`/`Card.Header`/`Card.Title` (so
   * `title` itself is never rendered in this mode — a `bare` caller has
   * nowhere to put one), but the Columns/Filter/search controls now render in
   * a plain toolbar row above the table regardless of `bare`, since none of
   * the three is actually `Card`-shaped. A `bare` caller that wants sort/
   * filter/column-picking parity with a standalone `EntityListPage` gets it
   * by passing the same `sortField`/`sortDir`/`onSortChange`/`filters`/
   * `onFiltersChange`/`search`/`onSearchChange` props any other caller would.
   *
   * Opt-in and default-off, so all 24 list screens and every existing
   * `entity-table.test.tsx` fixture render byte-for-byte as before.
   */
  bare?: boolean;
}

function EntityTable({
  title,
  headerActions,
  config,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortField,
  sortDir,
  onSortChange,
  loading,
  loadError,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  canEditRow = () => true,
  canDeleteRow = () => true,
  onEdit,
  onDelete,
  onUnlink,
  onRowClick,
  bare = false,
}: EntityTableProps) {
  // ADR-0071. `preferencesResource` tracks which entity `preferences` was
  // loaded for: this component is remounted-or-not across admin routes at
  // React's discretion, so a `config.resource` change has to re-read storage.
  // Adjusting state during render (rather than in an effect) is React's own
  // documented pattern for deriving state from changed props — it re-runs the
  // component immediately, before committing, so there is no frame where the
  // previous entity's columns are painted for this one's rows.
  const [preferencesResource, setPreferencesResource] = useState(config.resource);
  const [preferences, setPreferences] = useState<ColumnPreferences | null>(() =>
    loadColumnPreferences(config.resource),
  );
  const [showColumnPreferences, setShowColumnPreferences] = useState(false);
  if (preferencesResource !== config.resource) {
    setPreferencesResource(config.resource);
    setPreferences(loadColumnPreferences(config.resource));
    setShowColumnPreferences(false);
  }

  const defaultFields = useMemo(() => defaultTableFields(config), [config]);
  const lockedFields = useMemo(() => lockedFieldNames(config), [config]);
  const tableFields = useMemo(
    () => applyColumnPreferences(defaultFields, preferences, lockedFields),
    [defaultFields, preferences, lockedFields],
  );
  const preferenceRows = useMemo(
    () => toPreferenceRows(defaultFields, preferences, lockedFields),
    [defaultFields, preferences, lockedFields],
  );

  // ADR-0072: only the modal's *open/closed* flag lives here. The filters
  // themselves are `EntityListPage`'s — see the `filters` prop's own comment.
  const [showFilterModal, setShowFilterModal] = useState(false);

  function handleApplyColumnPreferences(next: ColumnPreferences) {
    saveColumnPreferences(config.resource, next);
    setPreferences(next);
    setShowColumnPreferences(false);
  }

  function handleResetColumnPreferences() {
    clearColumnPreferences(config.resource);
    setPreferences(null);
    setShowColumnPreferences(false);
  }

  // ADR-0077 adds the third disjunct. `onUnlink` carries **no**
  // `config.methods` conjunct on purpose — see that prop's own doc comment:
  // the capability it renders is declared by `config.linkDelete`, which is
  // precisely the thing `methods` does not and must not describe.
  const showActionsColumn =
    ((config.methods.includes("update") || config.methods.includes("delete")) && (onEdit || onDelete)) ||
    Boolean(onUnlink);

  // ADR-0053 (batching) / ADR-0073 (extracted to a shared hook so
  // `EntityDetailPage` reuses it): one `getEntity` per *distinct* fk id per fk
  // column across the current page, not one per row (§3). `config.fields` (not
  // `tableFields`) is the schema-fetch list, preserving this component's
  // pre-extraction behavior exactly — see `useFkLabels`' own doc comment.
  const fkLabels = useFkLabels(tableFields, rows, config.fields);

  function renderCell(field: FieldConfig, row: EntityRow) {
    return renderEntityFieldValue({ field, row, fkLabels, config });
  }

  /**
   * ADR-0073: a row is only interactive when the caller actually wired
   * `onRowClick`. Keyboard parity matters — a bare `onClick` on a `<tr>` is
   * mouse-only, so Enter/Space on a focused row fire the same navigation
   * (`role`/accessible-name computation is untouched: `tabIndex` changes
   * neither, so every existing `getByRole("row", {name})` lookup still
   * resolves the same way — `frontend/CLAUDE.md`'s nested-table note).
   */
  const rowInteractionProps = onRowClick
    ? (row: EntityRow) => ({
        onClick: () => onRowClick(row),
        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onRowClick(row);
          }
        },
        tabIndex: 0,
        style: { cursor: "pointer" },
        "data-testid": `entity-table-row-${String(row.id)}`,
      })
    : () => ({});

  const showSearch = Boolean(onSearchChange && config.searchFields && config.searchFields.length > 0);
  // ADR-0072. Suppressed for an entity whose served schema exposes no
  // filterable field at all — exactly the same posture `showSearch` above
  // already takes for an entity with no `searchFields`: don't render an
  // affordance the backend will silently ignore.
  const appliedFilters = filters ?? {};
  const showFilter = Boolean(onFiltersChange) && filterableFields(config).length > 0;
  const filterCount = activeFilterCount(appliedFilters);
  // AdminLTE "full-width table" card pattern: the table's own card-body is
  // `p-0` (cells carry their own padding) so it spans the card edge-to-edge —
  // but that only looks right once there's an actual table to fill it.
  // Loading/empty states fall back to a normally-padded body.
  const showTable = !loading && rows.length > 0;

  const sections = (
    <>
      {loadError && (
        <Card.Body className="border-bottom">
          <Alert color="danger" className="mb-0">
            {loadError}
          </Alert>
        </Card.Body>
      )}

      <Card.Body className={showTable ? "p-0" : undefined}>
        {loading ? (
        <Spinner wrapperClassName="py-4" />
      ) : rows.length === 0 ? (
        <p className="text-body-secondary mb-0">No records found.</p>
      ) : (
        <Table<EntityRow>
          mode="server"
          items={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          rowKey={(row) => String(row.id)}
          testIdPrefix="entity-table"
          footerClassName="card-footer"
          columns={
            <tr>
              {tableFields.map((field) => {
                const isSortable = Boolean(onSortChange) && field.sortable !== false;
                const isActive = sortField === field.name;
                return (
                  <th
                    scope="col"
                    key={field.name}
                    aria-sort={isActive ? (sortDir === "desc" ? "descending" : "ascending") : undefined}
                  >
                    {isSortable ? (
                      <Button
                        color="link"
                        className="p-0 text-decoration-none text-body fw-bold"
                        onClick={() => onSortChange!(field.name)}
                        data-testid={`entity-table-sort-${field.name}`}
                      >
                        {field.label}
                        <Icon
                          name={isActive ? (sortDir === "desc" ? "sort-down" : "sort-up") : "sort"}
                          className={`ms-1 ${isActive ? "" : "text-body-tertiary"}`}
                        />
                      </Button>
                    ) : (
                      field.label
                    )}
                  </th>
                );
              })}
              {showActionsColumn && <th scope="col">Actions</th>}
            </tr>
          }
          renderRow={(row) => (
            <tr {...rowInteractionProps(row)}>
              {tableFields.map((field) => (
                <td key={field.name}>{renderCell(field, row)}</td>
              ))}
              {showActionsColumn && (
                <td
                  /**
                   * ADR-0073: the row's own click handler must not fire when
                   * the user meant "Edit"/"Delete". One `stopPropagation` on
                   * the containing cell covers every current and future
                   * action control in it, rather than one per button.
                   */
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <div className="d-flex gap-2">
                    {config.methods.includes("update") && onEdit && canEditRow(row) && (
                      <Button
                        color="secondary"
                        outline
                        size="sm"
                        aria-label="Edit"
                        onClick={() => onEdit(row)}
                      >
                        <Icon name="pencil" />
                      </Button>
                    )}
                    {config.methods.includes("delete") && onDelete && canDeleteRow(row) && (
                      <Button
                        color="danger"
                        outline
                        size="sm"
                        aria-label="Delete"
                        onClick={() => onDelete(row)}
                      >
                        <Icon name="trash" />
                      </Button>
                    )}
                    {/*
                      ADR-0077. Same visual/a11y shape as the Delete button
                      above — `btn-outline-danger`, the `trash` glyph, an
                      `aria-label` carrying the accessible name because the
                      button is icon-only — but a different word, because the
                      thing it removes is the *link*, not the record the row
                      points at.
                    */}
                    {onUnlink && (
                      <Button
                        color="danger"
                        outline
                        size="sm"
                        aria-label="Remove"
                        title="Remove"
                        data-testid="entity-table-unlink"
                        onClick={() => onUnlink(row)}
                      >
                        <Icon name="trash" />
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          )}
        />
      )}
      </Card.Body>
    </>
  );

  /**
   * ADR-0092: the Columns/Filter/search controls themselves — extracted so
   * both render branches below share one copy. Previously these lived only
   * inside the non-`bare` `Card.Header`, so a `bare` mount (`EntityRelationTab`)
   * got none of them, even though nothing about Columns/Filter/search is
   * actually `Card`-shaped: `preferences`/`showFilterModal` are this
   * component's own state regardless of `bare`, and `showSearch`/`showFilter`
   * are already computed above from the caller's props alone.
   */
  const toolbarControls = (
    <>
      {showSearch && (
        <TextInput
          type="text"
          style={{ width: 200, maxWidth: "100%" }}
          placeholder="Search..."
          value={search ?? ""}
          onChange={(event) => onSearchChange!(event.target.value)}
          data-testid="entity-table-search"
        />
      )}
      <Button
        outline
        color="secondary"
        size="sm"
        aria-label="Columns"
        title="Columns"
        onClick={() => setShowColumnPreferences(true)}
        data-testid="entity-table-columns"
      >
        <Icon name="table-columns" />
      </Button>
      {showFilter && (
        <Button
          outline
          color={filterCount > 0 ? "primary" : "secondary"}
          size="sm"
          aria-label="Filter"
          title={filterCount > 0 ? `Filter (${filterCount} active)` : "Filter"}
          onClick={() => setShowFilterModal(true)}
          data-testid="entity-table-filter"
        >
          <Icon name="filter" />
          {/*
            ADR-0072: the active-filter count is load-bearing, not
            decoration. Filters are deliberately NOT persisted, and this
            badge is the mitigation for the reason why — an active filter
            is invisible in a way a hidden column is not, so without a
            visible count a narrowed list reads as missing data.
          */}
          {filterCount > 0 && (
            <span className="badge bg-primary ms-1" data-testid="entity-table-filter-count">
              {filterCount}
            </span>
          )}
        </Button>
      )}
      {headerActions}
    </>
  );

  const modals = (
    <>
      <ColumnPreferencesModal
        visible={showColumnPreferences}
        entityLabel={typeof title === "string" ? title : undefined}
        rows={preferenceRows}
        onClose={() => setShowColumnPreferences(false)}
        onApply={handleApplyColumnPreferences}
        onReset={handleResetColumnPreferences}
      />
      {showFilter && (
        <FilterModal
          visible={showFilterModal}
          entityLabel={typeof title === "string" ? title : undefined}
          config={config}
          filters={appliedFilters}
          onClose={() => setShowFilterModal(false)}
          onApply={(next) => {
            onFiltersChange!(next);
            setShowFilterModal(false);
          }}
        />
      )}
    </>
  );

  // ADR-0074 (Amendment) / ADR-0092: the caller already owns the card — see
  // `bare`'s own docstring — so this branch still skips `Card`/`Card.Header`/
  // `Card.Title` entirely. It no longer skips Columns/Filter/search though:
  // those controls aren't actually `Card`-shaped (see `toolbarControls`'s own
  // comment), so a bare mount now gets a plain toolbar row above `sections`
  // instead of losing the controls outright.
  if (bare) {
    return (
      <>
        <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 mb-2">
          {toolbarControls}
        </div>
        {sections}
        {modals}
      </>
    );
  }

  return (
    <Card className="h-100">
      <Card.Header className="d-flex flex-wrap align-items-center justify-content-between">
        <Card.Title>{title}</Card.Title>
        <div className="card-tools d-flex flex-wrap align-items-center gap-2 ms-auto">{toolbarControls}</div>
      </Card.Header>

      {sections}

      {modals}
    </Card>
  );
}

export default EntityTable;
