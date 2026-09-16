/**
 * ADR-0073: one `EntityConfig`-driven field-value renderer, shared by
 * `EntityTable`'s table cells and `EntityDetailPage`'s field list.
 *
 * Extracted verbatim from `EntityTable`'s own private `renderCell`/
 * `formatDate`/`displayValue` helpers — a **reuse extraction, not a new
 * design decision** (`frontend/CLAUDE.md`'s mandatory "check for an existing
 * primitive before hand-rolling markup" rule: the detail page needs the exact
 * same fk-label / enum-badge / boolean-badge / date-format / detail-link
 * behavior, and a second hand-rolled copy is precisely the near-duplicate that
 * rule exists to prevent).
 *
 * The rendered output is byte-for-byte what `EntityTable` produced before the
 * extraction — same `badge bg-*` classes (**`bg-*`, not Bootstrap 5.3's newer
 * `text-bg-*`**, per this repo's own AdminLTE convention and the existing badge
 * assertions), same `—` em-dash empty placeholder, same `<Link>` for a
 * `detailPath`/`detailLinkField` pair (ADR-0060). `EntityTable`'s own tests
 * pass unmodified across the move.
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EntityConfig, FieldConfig } from "../../../entityConfigs/types";
import { EntityRow } from "../../../lib/api/entityCrud";
import type { FkLabelMap } from "../../../pages/admin/useFkLabels";

/**
 * ADR-0060: `config.detailPath`'s own `:id` placeholder, filled from the
 * row's own id — deliberately narrower than `lib/api/entityCrud.ts`'s
 * `interpolate()` (route-context params like `:orgId`), since a detail link
 * only ever needs the row's own id, never ambient route context.
 */
export function interpolateDetailPath(template: string, id: unknown): string {
  return template.replace(":id", String(id));
}

export function formatDate(value: unknown): string {
  if (!value) {
    return "—";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export interface EntityFieldValueProps {
  field: FieldConfig;
  row: EntityRow;
  /** From `useFkLabels` — `{}` is fine, an unresolved fk renders its raw id. */
  fkLabels: FkLabelMap;
  config: EntityConfig;
  /**
   * ADR-0073: `EntityDetailPage` passes `false` — the whole row is already the
   * thing `detailPath` would navigate to, so re-rendering the name as a link to
   * the page you are already looking at is noise. `EntityTable` leaves it
   * `true` (the default), preserving ADR-0060's row-name link exactly.
   */
  linkDetailField?: boolean;
}

/** The raw `ReactNode` a cell/field renders — see the component below. */
export function renderEntityFieldValue({
  field,
  row,
  fkLabels,
  config,
  linkDetailField = true,
}: EntityFieldValueProps): ReactNode {
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
      // ADR-0053: backend-served, per-field. Anything the backend didn't
      // colour — including every value of an enum served with no
      // `badgeColors` at all — stays a plain grey badge, exactly as the old
      // module-level constant's own default did.
      const color = field.badgeColors?.[String(raw)] ?? "secondary";
      return <span className={`badge bg-${color}`}>{String(raw)}</span>;
    }
    default: {
      const text = displayValue(raw);
      // ADR-0060: restores ProjectsPage's "click a project's name to open
      // it" navigation, generically — see EntityConfig.detailPath's own
      // doc comment. Only fires for the one designated field, and only
      // when the row actually has an id to link to (never on "—").
      if (
        linkDetailField &&
        config.detailPath &&
        config.detailLinkField === field.name &&
        row.id !== undefined &&
        text !== "—"
      ) {
        return <Link to={interpolateDetailPath(config.detailPath, row.id)}>{text}</Link>;
      }
      return text;
    }
  }
}

export function EntityFieldValue(props: EntityFieldValueProps) {
  return <>{renderEntityFieldValue(props)}</>;
}

export default EntityFieldValue;
