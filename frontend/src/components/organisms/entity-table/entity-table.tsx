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
 */
import { ReactNode, useEffect, useState } from "react";
import Table from "../../../container/Table";
import { EntityConfig, FieldConfig } from "../../../entityConfigs/types";
import { EntityRow, getEntity } from "../../../lib/api/entityCrud";
import { entityConfigByKey } from "../../../pages/admin/registry";

const ENUM_BADGE_COLORS: Record<string, string> = {
  // Status-shaped values that read naturally as a semantic color; every
  // other enum value falls back to a plain grey badge (UI Design Document
  // §3: "color by value where the entity has an obvious status semantic...
  // plain text otherwise" — implemented here as a shared plain-grey default
  // rather than plain uncolored text, since a Bootstrap badge always carries
  // some `bg-*` background variant (as CoreUI's `CBadge` did before ADR-0042
  // — the values here are the Bootstrap theme-color names both use).
  critical: "danger",
  high: "danger",
  fail: "danger",
  suspended: "warning",
  blocked: "warning",
  medium: "warning",
  invited: "info",
  draft: "secondary",
  low: "success",
  pass: "success",
  active: "success",
  approved: "success",
  reviewed: "info",
  deprecated: "secondary",
  superseded: "secondary",
  skipped: "secondary",
};

function formatDate(value: unknown): string {
  if (!value) {
    return "—";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

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
  loading?: boolean;
  loadError?: string | null;
  filters?: Record<string, string>;
  onFilterChange?: (field: string, value: string) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  canEditRow?: (row: EntityRow) => boolean;
  canDeleteRow?: (row: EntityRow) => boolean;
  onEdit?: (row: EntityRow) => void;
  onDelete?: (row: EntityRow) => void;
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
  loading,
  loadError,
  search,
  onSearchChange,
  canEditRow = () => true,
  canDeleteRow = () => true,
  onEdit,
  onDelete,
}: EntityTableProps) {
  const tableFields = config.fields.filter((f) => f.showInTable !== false);
  const fkFields = tableFields.filter((f) => f.type === "fk" && f.refEntity);
  const [fkLabels, setFkLabels] = useState<Record<string, Record<string, string>>>({});

  const showActionsColumn = (config.methods.includes("update") || config.methods.includes("delete")) && (onEdit || onDelete);

  // Batched, deduped FK label resolution — one `getEntity` per distinct id
  // per FK field across the current page, not one per row (§3).
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const next: Record<string, Record<string, string>> = {};
      for (const field of fkFields) {
        const refConfig = field.refEntity ? entityConfigByKey[field.refEntity] : undefined;
        if (!refConfig) {
          continue;
        }
        const ids = Array.from(
          new Set(rows.map((row) => row[field.name]).filter((v): v is string => typeof v === "string")),
        );
        const entries = await Promise.all(
          ids.map(async (id) => {
            try {
              const row = await getEntity<EntityRow>(refConfig, id);
              const label = field.labelField ? row[field.labelField] : row.id;
              return [id, label === null || label === undefined ? id : String(label)] as const;
            } catch {
              return [id, id] as const;
            }
          }),
        );
        next[field.name] = Object.fromEntries(entries);
      }
      if (!cancelled) {
        setFkLabels(next);
      }
    }

    if (fkFields.length > 0) {
      void resolve();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function renderCell(field: FieldConfig, row: EntityRow) {
    const raw = row[field.name];
    switch (field.type) {
      case "fk": {
        const id = typeof raw === "string" ? raw : undefined;
        if (!id) {
          return "—";
        }
        return fkLabels[field.name]?.[id] ?? id;
      }
      case "boolean":
        return <span className={`badge bg-${raw ? "success" : "secondary"}`}>{raw ? "Yes" : "No"}</span>;
      case "date":
        return formatDate(raw);
      case "enum": {
        if (raw === null || raw === undefined || raw === "") {
          return "—";
        }
        const color = ENUM_BADGE_COLORS[String(raw)] ?? "secondary";
        return <span className={`badge bg-${color}`}>{String(raw)}</span>;
      }
      default:
        return displayValue(raw);
    }
  }

  const showSearch = Boolean(onSearchChange && config.searchFields && config.searchFields.length > 0);
  // AdminLTE "full-width table" card pattern: the table's own card-body is
  // `p-0` (cells carry their own padding) so it spans the card edge-to-edge —
  // but that only looks right once there's an actual table to fill it.
  // Loading/empty states fall back to a normally-padded body.
  const showTable = !loading && rows.length > 0;

  return (
    <div className="card h-100">
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
        <div className="card-tools d-flex align-items-center gap-2">
          {showSearch && (
            <input
              type="text"
              className="form-control form-control-sm"
              style={{ width: 200 }}
              placeholder="Search..."
              value={search ?? ""}
              onChange={(event) => onSearchChange!(event.target.value)}
              data-testid="entity-table-search"
            />
          )}
          {headerActions}
        </div>
      </div>

      {loadError && (
        <div className="card-body border-bottom">
          <div className="alert alert-danger mb-0" role="alert">
            {loadError}
          </div>
        </div>
      )}

      <div className={showTable ? "card-body p-0" : "card-body"}>
        {loading ? (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
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
          columns={
            <tr>
              {tableFields.map((field) => (
                <th scope="col" key={field.name}>
                  {field.label}
                </th>
              ))}
              {showActionsColumn && <th scope="col">Actions</th>}
            </tr>
          }
          renderRow={(row) => (
            <tr>
              {tableFields.map((field) => (
                <td key={field.name}>{renderCell(field, row)}</td>
              ))}
              {showActionsColumn && (
                <td>
                  <div className="d-flex gap-2">
                    {config.methods.includes("update") && onEdit && canEditRow(row) && (
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        aria-label="Edit"
                        onClick={() => onEdit(row)}
                      >
                        <i className="fa-solid fa-pencil" aria-hidden="true" />
                      </button>
                    )}
                    {config.methods.includes("delete") && onDelete && canDeleteRow(row) && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        aria-label="Delete"
                        onClick={() => onDelete(row)}
                      >
                        <i className="fa-solid fa-trash" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          )}
        />
      )}
      </div>
    </div>
  );
}

export default EntityTable;
