/**
 * `Pagination` molecule — the page-size selector + `<nav><ul class="pagination">`
 * block, extracted out of `container/Table.tsx` (DS-2/ADR-0041) so it can be
 * reused by any screen that owns its own paging state, not only `Table`'s two
 * modes. Raw Bootstrap 5 markup (ADR-0042); unchanged from what `Table.tsx`
 * rendered inline — every existing `data-testid`/role/class this repo's
 * tests already key off (`${testIdPrefix}-pagination`, `${testIdPrefix}-
 * page-size`, `page-item`/`active`/`disabled`, `aria-current="page"`) is
 * preserved verbatim.
 *
 * Deliberately has **no opinion on hiding itself** at `totalPages <= 1` —
 * that gating decision moved to each caller (`Table.tsx` now always renders
 * it; a future bespoke caller may want the same). Previous/Next still
 * disable correctly on a single page since that's derived from
 * `currentPage`/`totalPages`, not from a page count you'd hide behind.
 */
import { Select } from "../../atoms/select";

/**
 * The page-size options offered by every retrofitted screen (ADR-0041).
 * Moved here from `container/Table.tsx`, which now re-exports it for
 * backward compatibility — this is its natural home once pagination itself
 * is a standalone component.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  /**
   * Total row count across all pages — drives the "Showing X to Y of Z
   * items" summary. Optional so a caller that only ever knows page count
   * (not a real total) can omit it; the summary is skipped entirely then.
   */
  totalItems?: number;
  /** Defaults to `PAGE_SIZE_OPTIONS`. */
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Accessible name for the pagination nav. Defaults to "Page navigation". */
  paginationLabel?: string;
  /** `data-testid` prefix for the pagination row and page-size selector. Defaults to `"table"`. */
  testIdPrefix?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
  paginationLabel = "Page navigation",
  testIdPrefix = "table",
}: PaginationProps) {
  const isPreviousDisabled = currentPage <= 1;
  const isNextDisabled = currentPage >= totalPages;

  const rangeStart = !totalItems ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = !totalItems ? 0 : Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div className="d-flex align-items-center flex-wrap gap-3">
        {totalItems !== undefined && (
          <div className="text-body-secondary small" data-testid={`${testIdPrefix}-summary`}>
            Showing {rangeStart} to {rangeEnd} of {totalItems} {totalItems === 1 ? "item" : "items"}
          </div>
        )}

        <div className="d-flex align-items-center gap-2">
          <label className="mb-0 text-body-secondary small" htmlFor={`${testIdPrefix}-page-size`}>
            Rows per page
          </label>
          <Select
            id={`${testIdPrefix}-page-size`}
            style={{ width: "auto" }}
            aria-label="Rows per page"
            data-testid={`${testIdPrefix}-page-size`}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <nav
        aria-label={paginationLabel}
        data-testid={`${testIdPrefix}-pagination`}
        className="overflow-x-auto"
      >
        <ul className="pagination flex-nowrap mb-0">
          <li className={`page-item${isPreviousDisabled ? " disabled" : ""}`}>
            <button
              type="button"
              className="page-link"
              disabled={isPreviousDisabled}
              onClick={() => onPageChange(currentPage - 1)}
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
                onClick={() => onPageChange(p)}
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
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
