/**
 * `components/crud/` (ADR-0023). UI Design Document §2/§3: a `CTable` with
 * one column per `fields[]` entry (`showInTable !== false`), a filter row
 * for `filterFields`, a `?q=` search box when `searchFields` is non-empty,
 * pagination (`CPagination`), and a trailing actions column whose Edit/
 * Delete icons (`cilPencil`/`cilTrash`) are present only when both (a) the
 * config's own `methods` include `"update"`/`"delete"` and (b) the caller's
 * per-row permission callback allows it (§5 — absent, not disabled, either
 * way: a `methods` gap is a structural read-only entity, a permission gap
 * is per-row).
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
import { useEffect, useState } from "react";
import { CIcon } from "@coreui/icons-react";
import { cilPencil, cilTrash } from "@coreui/icons";
import {
  CAlert,
  CBadge,
  CButton,
  CFormInput,
  CSpinner,
  CTableDataCell,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";
import Table from "../../container/Table";
import { EntityConfig, FieldConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { entityConfigByKey } from "../../pages/admin/registry";

const ENUM_BADGE_COLORS: Record<string, string> = {
  // Status-shaped values that read naturally as a semantic color; every
  // other enum value falls back to a plain grey badge (UI Design Document
  // §3: "color by value where the entity has an obvious status semantic...
  // plain text otherwise" — implemented here as a shared plain-grey default
  // rather than plain uncolored text, since CBadge has no "no color" mode).
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
  config,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  loadError,
  filters = {},
  onFilterChange,
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
        return <CBadge color={raw ? "success" : "secondary"}>{raw ? "Yes" : "No"}</CBadge>;
      case "date":
        return formatDate(raw);
      case "enum": {
        if (raw === null || raw === undefined || raw === "") {
          return "—";
        }
        const color = ENUM_BADGE_COLORS[String(raw)] ?? "secondary";
        return <CBadge color={color}>{String(raw)}</CBadge>;
      }
      default:
        return displayValue(raw);
    }
  }

  return (
    <div>
      {onSearchChange && config.searchFields && config.searchFields.length > 0 && (
        <CFormInput
          className="mb-3"
          placeholder="Search..."
          value={search ?? ""}
          onChange={(event) => onSearchChange(event.target.value)}
          data-testid="entity-table-search"
        />
      )}

      {onFilterChange && config.filterFields && config.filterFields.length > 0 && (
        <div className="d-flex gap-2 mb-3">
          {config.filterFields.map((field) => (
            <CFormInput
              key={field}
              placeholder={`Filter ${field}`}
              value={filters[field] ?? ""}
              onChange={(event) => onFilterChange(field, event.target.value)}
              data-testid={`entity-table-filter-${field}`}
            />
          ))}
        </div>
      )}

      {loadError && (
        <CAlert color="danger" role="alert">
          {loadError}
        </CAlert>
      )}

      {loading ? (
        <div className="d-flex justify-content-center py-4">
          <CSpinner color="primary" />
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
            <CTableRow>
              {tableFields.map((field) => (
                <CTableHeaderCell key={field.name}>{field.label}</CTableHeaderCell>
              ))}
              {showActionsColumn && <CTableHeaderCell>Actions</CTableHeaderCell>}
            </CTableRow>
          }
          renderRow={(row) => (
            <CTableRow>
              {tableFields.map((field) => (
                <CTableDataCell key={field.name}>{renderCell(field, row)}</CTableDataCell>
              ))}
              {showActionsColumn && (
                <CTableDataCell>
                  <div className="d-flex gap-2">
                    {config.methods.includes("update") && onEdit && canEditRow(row) && (
                      <CButton
                        size="sm"
                        color="secondary"
                        variant="outline"
                        aria-label="Edit"
                        onClick={() => onEdit(row)}
                      >
                        <CIcon icon={cilPencil} />
                      </CButton>
                    )}
                    {config.methods.includes("delete") && onDelete && canDeleteRow(row) && (
                      <CButton
                        size="sm"
                        color="danger"
                        variant="outline"
                        aria-label="Delete"
                        onClick={() => onDelete(row)}
                      >
                        <CIcon icon={cilTrash} />
                      </CButton>
                    )}
                  </div>
                </CTableDataCell>
              )}
            </CTableRow>
          )}
        />
      )}
    </div>
  );
}

export default EntityTable;
