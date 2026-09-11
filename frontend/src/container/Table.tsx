/**
 * Shared `Table` container (DS-2, [ADR-0041]): one table + pagination +
 * page-size-selector implementation, reused by every outermost table in the
 * app instead of the six divergent bespoke ones that existed before it.
 *
 * ## Location: why `container/`, not `components/`
 *
 * ADR-0023 originally drew two component-directory buckets (`shared/`,
 * `crud/`) on a composition-shape axis; ADR-0041 amended it to add a third,
 * orthogonal axis for this component. **ADR-0043 (2026-09-08) then replaced
 * the two original buckets with atomic-design tiers** (`atoms/`/`molecules/`/
 * `organisms/`/`templates/`, sized by composition complexity) — `container/`
 * is unaffected by that change, because the axis it answers was never about
 * composition complexity in the first place:
 *
 * - `components/<tier>/` — sized by **composition complexity** (how many
 *   smaller pieces a component is built from). `FormField`
 *   (`components/molecules/form-field/`) is a stateless composition
 *   primitive; `EntityTable`/`EntityForm`/`FkAutocomplete`
 *   (`components/organisms/`, `components/molecules/`) are generic-entity-
 *   shape-driven widgets coupled to `EntityConfig`/`FieldConfig`. `Table` is
 *   deliberately in neither: it owns `page`/`pageSize` state and the actions
 *   that mutate them, and every bespoke screen's table has a different row
 *   shape with no `EntityConfig` behind it — a component those screens can
 *   actually consume has to be config-shape-agnostic, which `EntityTable`
 *   structurally isn't.
 * - `container/` (this directory, new in DS-2) — sized by **state
 *   ownership**: components that own state and expose actions, consumed by
 *   many screens with no shared data shape between them. Independent of
 *   which atomic tier a component would otherwise sit at.
 *
 * `EntityTable` still exists and still owns its `EntityConfig`-driven column
 * system; ADR-0041 explicitly declines to merge the two call conventions.
 * It simply delegates its pagination/page-size chrome here now.
 *
 * ## Two modes, one component
 *
 * - `mode="server"` — the caller passes the **current page's rows only**
 *   (`items`) plus `total`, `page`, `pageSize`, `onPageChange`,
 *   `onPageSizeChange`. This component never slices; it renders what it is
 *   given and fires callbacks. The caller's own `useQuery` re-fetches.
 * - `mode="client"` — the caller passes the **full, already-filtered and
 *   already-sorted array**. This component computes `totalPages` and the
 *   current page's slice itself. Used only by `OrgHome`'s Project table,
 *   whose client-side search/sort is ADR-0039's own still-standing decision
 *   (this ADR replaces only the pagination chrome around it, not that call).
 *
 * The component has **zero opinion on search/filter/sort**. Whatever produced
 * the rows lives in the caller and is passed through the `header` slot
 * verbatim (`OrgHome`'s search box + `SortableHeader` cells, `EntityTable`'s
 * `?q=` input and filter row).
 *
 * ## Behavior contracts (Test Design §34 / TC-DS-009..018)
 *
 * - Changing the page size **always resets to page 1**, in both modes — a
 *   page number valid under a smaller size can be out of range under a
 *   larger one (TC-DS-011).
 * - The pagination row (and the page-size selector with it) renders **only
 *   when there is more than one page's worth of data** — not a disabled
 *   single-page control. Matches `EntityTable`'s and `OrgHome`'s existing
 *   pre-migration behavior exactly, so no assertion about it changes
 *   (TC-DS-009, TC-DS-014).
 * - Page size is **component state only — never persisted**. Navigating away
 *   and back, or reloading, returns to the caller's `defaultPageSize`
 *   (TC-DS-018). Do not "improve" this into `localStorage`/a URL param
 *   without a new ADR; ADR-0041 decided it explicitly.
 * - Empty state is the **caller's**, not this component's: with zero rows the
 *   caller renders its own message (`"No projects yet."`,
 *   `"No records found."`, …) and this component renders nothing at all.
 *   Screens have meaningfully different empty-state copy and some
 *   distinguish "none exist" from "none match your search" (TC-DS-014).
 * - This container is for **outermost, non-nested tables only**. Never wrap a
 *   list that renders inside another table row's expanded cell — those stay
 *   flat `<ul>/<li>` per `frontend/CLAUDE.md`'s ARIA-accessible-name rule
 *   (a `<table>` inside a `<td>` makes the outer row's computed name
 *   aggregate the inner rows' text, breaking `getByRole("row", {name})`
 *   strict-mode lookups). TC-DS-017 asserts this boundary still holds.
 *
 * ## Markup: raw Bootstrap 5 / AdminLTE (ADR-0042), was CoreUI (ADR-0012)
 *
 * DS-2 originally shipped this container on `@coreui/react`
 * (`CTable`/`CPagination`/`CPaginationItem`/`CFormSelect`), with the
 * pagination block copied verbatim from `EntityTable`'s pre-DS-2
 * implementation so the 24 generic-admin list screens' assertions passed
 * unmodified (TC-DS-016). ADR-0042 replaces CoreUI with AdminLTE v4, which
 * *is* Bootstrap 5 plus layout classes, so every one of those components maps
 * to the stock Bootstrap markup CoreUI was rendering anyway:
 * `<div class="table-responsive"><table class="table table-hover">`,
 * `<nav><ul class="pagination"><li class="page-item"><button class="page-link">`,
 * `<select class="form-select form-select-sm">`. The rendered class contract
 * (`page-item`/`active`/`disabled`, `columnheader`/`row`/`cell` roles, every
 * `data-testid`) is unchanged, so TC-DS-016 still holds.
 *
 * **Caller-visible consequence of ADR-0042:** `columns` and `renderRow` now
 * receive **raw `<tr>`/`<th scope="col">`/`<td>` elements**, not
 * `<CTableRow>`/`<CTableHeaderCell>`/`<CTableDataCell>`. The prop *types*
 * (`ReactNode` / `(item: T) => ReactNode`) are unchanged — it is the JSX
 * callers hand in that changed. Header cells must carry `scope="col"`
 * themselves: `CTableHeaderCell` defaulted it, a bare `<th>` does not, and
 * `getByRole("columnheader")`/row-name computation depend on the real
 * `<thead>`/`<th>` semantics.
 *
 * One deliberate behavior change: `CPaginationItem` rendered the *active* page
 * as a `<span>` with `onClick` silently dropped (see `frontend/CLAUDE.md`), so
 * clicking the current page did nothing. It is now a real `<button>` carrying
 * `aria-current="page"`, so clicking it fires `onPageChange(currentPage)` — a
 * harmless no-op navigation to the page you are already on, and the disabled
 * Previous/Next buttons now carry a real `disabled` attribute rather than only
 * a `disabled` class.
 *
 * [ADR-0041]: docs/adr/0041-ds-2-table-container-shared-pagination.md
 * ADR-0042: the CoreUI -> AdminLTE v4 migration (`docs/adr/`).
 *
 * ## Tabler v1.5.1 table idioms (added 2026-09-11, cascade-favors-Tabler pass)
 *
 * Tabler's `.table`/`.card`/`.btn` tokens already win project-wide since
 * ADR-0054 moved the cascade; this container just opts into the Tabler-shaped
 * defaults so the rendered look matches the rest of Tabler without a caller-
 * side change:
 *
 * - `.table-vcenter` is the default (added unconditionally with `table-hover`),
 *   matching Tabler's polished vertical-centered look. Opt out via
 *   `tableProps.className` overriding, or accept it as the new normal.
 * - The default wrapper is `<div className="table-responsive">`; pass
 *   `responsive="md"` (or `"sm"`/`"lg"`/`"xl"`) to scope the horizontal scroll
 *   to below that breakpoint, or `responsive={false}` to drop the wrapper
 *   entirely when the caller has its own.
 * - Pass `stickyHeader` to add `.sticky-top` to the `<thead>` for long tables
 *   where the header should stay visible while rows scroll past.
 * - Pass `caption` to render a real `<caption>` element (Tabler's a11y note
 *   says this is load-bearing for screen-reader announcement).
 *
 * ## Caller-side Tabler composition patterns (no new prop needed)
 *
 * Tabler documents several table shapes the container deliberately leaves to
 * the caller, since they're row-/cell-level composition choices that don't
 * belong on this outer container's API:
 *
 * - **Sortable headers** — render a `<button class="table-sort" data-sort="x">`
 *   inside a `<th scope="col">`, set `aria-sort="ascending|descending|none"`
 *   on the `<th>`. The button is keyboard-reachable; the actual sort logic
 *   lives in the caller's own state.
 * - **Selectable rows** — add `.table-selectable` to `tableProps.className`,
 *   render `.table-selectable-check` checkboxes, use `.on-checked`/`.on-
 *   unchecked` spans inside the row for state-dependent content. Pure CSS,
 *   no JS.
 * - **Mobile-stacked** — add `table-mobile-md` (or `-sm`/`-lg`/`-xl`) to
 *   `tableProps.className`, set `data-label="..."` on each `<td>`. The table
 *   collapses into a stacked list below that breakpoint.
 * - **Truncated cells** — `<td className="td-truncate"><div className="text-
 *   truncate">long content</div></td>` keeps long values from stretching the
 *   column.
 * - **Contextual row variants** — `<tr className="table-primary|table-danger|
 *   ...">` on the caller's `renderRow` output.
 */
import { ReactNode, useEffect, useState } from "react";

/**
 * The page-size options offered by every retrofitted screen (ADR-0041).
 * Exported so tests and callers can assert against the canonical list rather
 * than re-declaring it.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export type TableMode = "server" | "client";

export interface TableProps<T> {
  /** See the file docstring — `"server"` slices nothing, `"client"` slices locally. */
  mode: TableMode;
  /**
   * Server mode: the current page's rows only. Client mode: the **full**
   * already-filtered/sorted array.
   */
  items: T[];
  /**
   * Server mode only: the total row count across all pages, from the
   * `{items,total,page,page_size}` envelope. Ignored in client mode, where
   * `items.length` is the total by definition.
   */
  total?: number;
  /** Stable React key per row. */
  rowKey: (item: T) => string;
  /**
   * The `<thead>`'s contents: a `<tr>` of `<th scope="col">`s — the caller
   * owns column definitions. Raw elements since ADR-0042 (was `<CTableRow>` /
   * `<CTableHeaderCell>`); `scope="col"` is the caller's responsibility now.
   */
  columns: ReactNode;
  /**
   * One `<tr>` of `<td>`s per item — the caller owns cell rendering. Raw
   * elements since ADR-0042 (was `<CTableRow>` / `<CTableDataCell>`).
   */
  renderRow: (item: T) => ReactNode;
  /** Optional toolbar/search/title slot, rendered above the table. */
  header?: ReactNode;
  /** Initial page size. Defaults to 25; `OrgHome` passes 10 to preserve ADR-0039's default. */
  defaultPageSize?: number;
  /**
   * Server mode: the controlled current page. Client mode: ignored (page is
   * internal state).
   */
  page?: number;
  /** Server mode: the controlled current page size. Client mode: ignored. */
  pageSize?: number;
  /** Server mode: fired when the user picks a different page. */
  onPageChange?: (page: number) => void;
  /**
   * Server mode: fired when the user picks a different page size. Always
   * accompanied by an `onPageChange(1)` call — see TC-DS-011.
   */
  onPageSizeChange?: (pageSize: number) => void;
  /**
   * Client mode only: change this string whenever the caller's own
   * search/filter/sort state changes, and the container resets to page 1.
   *
   * Client mode owns `page` internally, so a caller has no `setPage` of its
   * own to call — but "the user typed in the search box, so go back to page
   * 1" is genuinely the caller's decision to make, not something the
   * container can infer (a changed `items` array could equally be a
   * background refetch, where holding position is correct). This prop is the
   * minimal hook for that. `OrgHome` passes `${search}|${sortField}|
   * ${sortDir}`, exactly reproducing the `setPage(1)` calls its
   * pre-DS-2 search `onChange`/`handleSort` made.
   *
   * Deliberately narrower than remounting via React's own `key`: a remount
   * would also reset the selected page size, which must survive a search
   * (nothing about typing a filter term implies the user wants 10 rows again
   * after choosing 50). Server mode ignores this — the caller already owns
   * `page` there and resets it directly.
   */
  resetPageKey?: string;
  /**
   * Props forwarded to the underlying `<table>` element. Since ADR-0042 this
   * is a raw DOM element, so pass real HTML/React attributes — Bootstrap
   * modifier classes go through `className` (`"table-sm"`, `"align-middle"`,
   * `"table-striped"`), not CoreUI's old boolean props (`small`, `align`).
   * A `className` here is appended to the container's own `table table-hover`.
   */
  tableProps?: Record<string, unknown>;
  /** Accessible name for the pagination nav. Defaults to "Page navigation". */
  paginationLabel?: string;
  /** `data-testid` prefix for the pagination row and page-size selector. */
  testIdPrefix?: string;
  /**
   * When true, the `<thead>` gets `.sticky-top` so the header stays visible
   * while long bodies scroll past. Tabler/Bootstrap utility — works under
   * the current cascade without extra CSS.
   */
  stickyHeader?: boolean;
  /**
   * Controls the responsive wrapper:
   *   - `"always"` (default) — `<div className="table-responsive">`, scrolls at every width
   *   - `"sm" | "md" | "lg" | "xl"` — Tabler's `table-responsive-{bp}` variants, scroll only below that breakpoint
   *   - `false` — no wrapper, caller's responsibility (e.g. nested inside an already-scrolling container)
   */
  responsive?: "always" | "sm" | "md" | "lg" | "xl" | false;
  /**
   * Optional accessible caption. Rendered as a real `<caption>` element
   * inside `<table>` when provided — Tabler's a11y section calls this out
   * specifically (caption is announced first by screen readers and stays
   * tied to the table).
   */
  caption?: ReactNode;
  /**
   * Optional card-title. When set, the whole container enters **card mode**:
   * outer becomes `<div class="card">`, a `.card-header` is rendered with
   * this title (as `<h3 class="card-title">`) followed by the existing
   * `header` slot (search box, toolbar, ...) and the optional `cardActions`
   * div, and the table itself gets `card-table` instead of `table-vcenter` —
   * Tabler's own "Table in a card" pattern (drops bottom margin, runs
   * edge-to-edge inside the card). The responsive wrapper is suppressed in
   * card mode (the card border constrains width).
   */
  cardTitle?: ReactNode;
  /**
   * Optional header action content, rendered inside `.card-actions` next to
   * `cardTitle`. Pass the caller's own buttons/links — typically a "New X"
   * primary button (matches Tabler's own Card Actions example).
   */
  cardActions?: ReactNode;
}

/**
 * Shared table + pagination + page-size selector. See the file docstring for
 * the full contract; `mode` is the one prop that changes what everything else
 * means.
 */
function Table<T>({
  mode,
  items,
  total,
  rowKey,
  columns,
  renderRow,
  header,
  defaultPageSize = 25,
  page: controlledPage,
  pageSize: controlledPageSize,
  onPageChange,
  onPageSizeChange,
  resetPageKey,
  tableProps,
  paginationLabel = "Page navigation",
  testIdPrefix = "table",
  stickyHeader = false,
  responsive = "always",
  caption,
  cardTitle,
  cardActions,
}: TableProps<T>) {
  // Client mode owns both page and page size internally (there is nothing to
  // re-fetch). Server mode owns neither — the caller drives both so its own
  // query key can change — except for the *initial* page size, which the
  // caller seeds from `defaultPageSize` and then controls.
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(defaultPageSize);

  const isServer = mode === "server";
  const effectivePageSize = isServer ? (controlledPageSize ?? defaultPageSize) : clientPageSize;
  const effectiveTotal = isServer ? (total ?? 0) : items.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / effectivePageSize));

  // Clamp rather than trust: in client mode the caller's own filtering (a
  // search term narrowing 30 rows to 3) can shrink the array under a page
  // number that was valid a render ago. `OrgHome`'s pre-migration code did
  // exactly this same `Math.min(page, totalPages)` for the same reason.
  const rawPage = isServer ? (controlledPage ?? 1) : clientPage;
  const currentPage = Math.min(Math.max(rawPage, 1), totalPages);

  const visibleItems = isServer
    ? items
    : items.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  // `defaultPageSize` is a prop, so a caller that changes it (none do today,
  // but nothing prevents it) should not be silently ignored in client mode.
  useEffect(() => {
    if (!isServer) {
      setClientPageSize(defaultPageSize);
      setClientPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPageSize]);

  // Client mode: the caller's own search/sort changed — go back to page 1.
  // Page *size* is deliberately left alone (see `resetPageKey`'s own doc).
  useEffect(() => {
    if (!isServer) {
      setClientPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetPageKey]);

  function goToPage(next: number) {
    if (isServer) {
      onPageChange?.(next);
    } else {
      setClientPage(next);
    }
  }

  function changePageSize(next: number) {
    // TC-DS-011: page-size change ALWAYS resets to page 1, both modes. In
    // server mode that means firing both callbacks, not just the size one —
    // the caller's query key carries `page` too, and re-fetching page 3 of a
    // freshly-coarsened pagination could be out of range or plain wrong.
    if (isServer) {
      onPageSizeChange?.(next);
      onPageChange?.(1);
    } else {
      setClientPageSize(next);
      setClientPage(1);
    }
  }

  // TC-DS-009/TC-DS-014: the pagination row renders only past one page's
  // worth of data — same as both pre-migration implementations. The page-size
  // selector lives inside that row, so it follows the same rule.
  const showPaginationRow = totalPages > 1;

  // `tableProps.className` is merged with (not allowed to clobber) the
  // container's own table classes. Card mode swaps `table-vcenter table-hover`
  // for `card-table` (Tabler's own pattern for tables inside cards: drops the
  // bottom margin, runs edge-to-edge inside the card border, manages its own
  // cell padding). Outside card mode the default is `table-vcenter table-hover`.
  const useCard = cardTitle !== undefined && cardTitle !== null;
  const { className: extraTableClassName, ...restTableProps } = (tableProps ?? {}) as {
    className?: string;
  } & Record<string, unknown>;
  const baseTableClasses = useCard ? ["table", "card-table"] : ["table", "table-vcenter", "table-hover"];
  const tableClassName = [...baseTableClasses, extraTableClassName].filter(Boolean).join(" ");

  // `responsive` controls the horizontal-scroll wrapper. In card mode the
  // wrapper is suppressed unconditionally — the card's own border is the
  // horizontal-scroll container, and stacking `table-responsive` over it
  // double-pads. Outside card mode: `false` = no wrapper, default = always,
  // `"sm"|"md"|"lg"|"xl"` = Tabler breakpoint variants.
  const responsiveClassName = useCard
    ? null
    : responsive === false
      ? null
      : responsive === undefined || responsive === "always"
        ? "table-responsive"
        : `table-responsive-${responsive}`;

  const isPreviousDisabled = currentPage <= 1;
  const isNextDisabled = currentPage >= totalPages;

  const tableElement = (
    <table className={tableClassName} {...restTableProps}>
      {caption !== undefined && caption !== null && <caption>{caption}</caption>}
      <thead className={stickyHeader ? "sticky-top" : undefined}>{columns}</thead>
      <tbody>
        {visibleItems.map((item) => (
          <TableRowSlot key={rowKey(item)}>{renderRow(item)}</TableRowSlot>
        ))}
      </tbody>
    </table>
  );

  // The card-header hosts `cardTitle` (h3.card-title), the existing `header`
  // slot (search box, toolbar), and the new `cardActions` div for header
  // buttons. The order matches Tabler's own Card Actions example.
  const cardHeader =
    useCard && (
      <div className="card-header">
        <h3 className="card-title">{cardTitle}</h3>
        {header}
        {cardActions !== undefined && cardActions !== null && (
          <div className="card-actions">{cardActions}</div>
        )}
      </div>
    );

  const paginationBlock = showPaginationRow && (
    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div className="d-flex align-items-center gap-2">
        <label className="mb-0 text-body-secondary small" htmlFor={`${testIdPrefix}-page-size`}>
          Rows per page
        </label>
        <select
          className="form-select form-select-sm"
          id={`${testIdPrefix}-page-size`}
          style={{ width: "auto" }}
          aria-label="Rows per page"
          data-testid={`${testIdPrefix}-page-size`}
          value={effectivePageSize}
          onChange={(event) => changePageSize(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label={paginationLabel} data-testid={`${testIdPrefix}-pagination`}>
        <ul className="pagination">
          <li className={`page-item${isPreviousDisabled ? " disabled" : ""}`}>
            <button
              type="button"
              className="page-link"
              disabled={isPreviousDisabled}
              onClick={() => goToPage(currentPage - 1)}
            >
              Previous
            </button>
          </li>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <li key={p} className={`page-item${p === currentPage ? " active" : ""}`}>
              <button
                type="button"
                className="page-link"
                aria-current={p === currentPage ? "page" : undefined}
                onClick={() => goToPage(p)}
              >
                {p}
              </button>
            </li>
          ))}
          <li className={`page-item${isNextDisabled ? " disabled" : ""}`}>
            <button
              type="button"
              className="page-link"
              disabled={isNextDisabled}
              onClick={() => goToPage(currentPage + 1)}
            >
              Next
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );

  if (useCard) {
    return (
      <div className="card">
        {cardHeader}
        {responsiveClassName ? <div className={responsiveClassName}>{tableElement}</div> : tableElement}
        {paginationBlock}
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* `responsive` on the old CTable = this wrapper (ADR-0042 spec §2.1). */}
      {responsiveClassName ? <div className={responsiveClassName}>{tableElement}</div> : tableElement}

      {paginationBlock}
    </div>
  );
}

/**
 * Pass-through wrapper that exists only to carry the React `key` onto the
 * caller's `renderRow` output without this component having to `cloneElement`
 * it (which would silently overwrite a caller-set key and is brittle across
 * fragments). Renders exactly its children — no DOM node of its own, so the
 * `<tbody>` still contains only `<tr>`s and nothing about the rendered table
 * markup differs from the hand-rolled versions this container replaces.
 */
function TableRowSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export default Table;
